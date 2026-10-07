<#
  Orchestrator tenant switch runner.

  Started by the extension outside Studio's process tree (via WMI) because Studio restarts
  its extension host when the tenant changes. Reads a job file, performs the switch and
  writes progress/results to the status file named in the job. Secrets are read from
  Windows Credential Manager here and are never written to the job, status or log files.
#>
param([Parameter(Mandatory = $true)][string]$Job)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'credman.ps1')

$spec = Get-Content -LiteralPath $Job -Raw -Encoding UTF8 | ConvertFrom-Json
$secrets = New-Object System.Collections.Generic.List[string]

$status = [ordered]@{
  jobId      = $spec.jobId
  state      = 'running'
  targetId   = $spec.target.id
  targetName = $spec.target.name
  success    = $false
  rolledBack = $false
  message    = ''
  steps      = @()
  startedAt  = (Get-Date).ToString('o')
  finishedAt = $null
}

function Hide-Secrets([string]$text) {
  if (-not $text) { return '' }
  foreach ($s in $secrets) { if ($s) { $text = $text.Replace($s, '********') } }
  return $text.Trim()
}

function Write-Log([string]$line) {
  try { Add-Content -LiteralPath $spec.logPath -Value ("{0:u} [{1}] {2}" -f (Get-Date), $spec.jobId, (Hide-Secrets $line)) -Encoding UTF8 } catch { }
}

function Save-Status {
  $tmp = "$($spec.statusPath).tmp"
  ($status | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $spec.statusPath -Force
}

function Add-Step([string]$name, [string]$outcome, [string]$detail = '') {
  # outcome: ok | warning | failed | skipped
  $status.steps += [ordered]@{ name = $name; outcome = $outcome; detail = (Hide-Secrets $detail) }
  Write-Log "$name -> $outcome $detail"
  Save-Status
}

# Quotes one argument for CreateProcess / CommandLineToArgvW.
function ConvertTo-Arg([string]$s) {
  if ($s -eq '') { return '""' }
  if ($s -notmatch '[\s"]') { return $s }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  $backslashes = 0
  foreach ($c in $s.ToCharArray()) {
    if ($c -eq '\') { $backslashes++; continue }
    if ($c -eq '"') { [void]$sb.Append('\' * ($backslashes * 2 + 1)); [void]$sb.Append('"') }
    else { [void]$sb.Append('\' * $backslashes); [void]$sb.Append($c) }
    $backslashes = 0
  }
  [void]$sb.Append('\' * ($backslashes * 2))
  [void]$sb.Append('"')
  return $sb.ToString()
}

function Invoke-Exe([string]$file, [string[]]$arguments, [int]$timeoutSec = 90, [hashtable]$envVars = @{}) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $file
  $psi.Arguments = ($arguments | ForEach-Object { ConvertTo-Arg $_ }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($k in $envVars.Keys) { $psi.EnvironmentVariables[$k] = $envVars[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($timeoutSec * 1000)) {
    try { $p.Kill() } catch { }
    return @{ code = -999; output = "Timed out after $timeoutSec s" }
  }
  $p.WaitForExit()
  return @{ code = $p.ExitCode; output = (($out.Result + "`n" + $err.Result).Trim()) }
}

function Get-Secret($preset) {
  $s = Read-OcSecret $preset.id
  if ($null -eq $s -or $s -eq '') { throw "No stored client secret for preset '$($preset.name)'." }
  $secrets.Add($s)
  return $s
}

function Connect-Robot($preset) {
  $secret = Get-Secret $preset
  return Invoke-Exe $spec.uiRobotPath @('connect', '--url', $preset.url, '--clientId', $preset.clientId, '--clientSecret', $secret)
}

function Finish([bool]$success, [string]$message) {
  $status.success = $success
  $status.message = Hide-Secrets $message
  $status.state = 'done'
  $status.finishedAt = (Get-Date).ToString('o')
  Save-Status
  Write-Log "Finished: success=$success $message"
  exit 0
}

try {
  Write-Log "Switching to '$($spec.target.name)' ($($spec.target.url))"
  Save-Status

  # 1. Close Assistant so it reconnects cleanly afterwards.
  if ($spec.restartAssistant) {
    $procs = @(Get-Process -Name 'UiPath.Assistant' -ErrorAction SilentlyContinue)
    if ($procs.Count -gt 0) {
      $procs | Stop-Process -Force -ErrorAction SilentlyContinue
      $procs | ForEach-Object { try { $_.WaitForExit(15000) | Out-Null } catch { } }
      Add-Step 'Close Assistant' 'ok' "$($procs.Count) process(es) closed"
    } else {
      Add-Step 'Close Assistant' 'skipped' 'Assistant was not running'
    }
  }

  # 2. Disconnect. A non-zero exit here usually means "already disconnected", so it is only a warning.
  $r = Invoke-Exe $spec.uiRobotPath @('disconnect')
  Add-Step 'Disconnect Robot' $(if ($r.code -eq 0) { 'ok' } else { 'warning' }) "exit $($r.code) $($r.output)"

  # 3. Connect to the target tenant, rolling back to the previous one on failure.
  $r = Connect-Robot $spec.target
  if ($r.code -eq 0) {
    Add-Step 'Connect Robot' 'ok' $spec.target.url
  } else {
    Add-Step 'Connect Robot' 'failed' "exit $($r.code) $($r.output)"
    $reason = "UiRobot connect failed (exit $($r.code)): $($r.output)"
    if ($spec.previous) {
      try {
        $rb = Connect-Robot $spec.previous
        if ($rb.code -eq 0) {
          $status.rolledBack = $true
          Add-Step "Reconnect previous ($($spec.previous.name))" 'ok' $spec.previous.url
          $reason += " Reconnected to '$($spec.previous.name)'."
        } else {
          Add-Step "Reconnect previous ($($spec.previous.name))" 'failed' "exit $($rb.code) $($rb.output)"
          $reason += ' Rollback also failed; the Robot is disconnected.'
        }
      } catch {
        Add-Step "Reconnect previous ($($spec.previous.name))" 'failed' $_.Exception.Message
        $reason += ' Rollback failed; the Robot is disconnected.'
      }
    } else {
      $reason += ' No previous preset known, so the Robot is now disconnected.'
    }
    if ($spec.restartAssistant -and $spec.assistantPath) { Start-Process -FilePath $spec.assistantPath -ErrorAction SilentlyContinue }
    Finish $false $reason
  }

  # 4. Restart the Robot Windows service, if this install has one (service mode).
  $svc = Get-Service -Name 'UiPath Robot' -ErrorAction SilentlyContinue
  if ($null -eq $svc) {
    Add-Step 'Restart Robot service' 'skipped' 'No UiPath Robot service (user-mode install)'
  } else {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    try {
      if ($isAdmin) {
        Restart-Service -Name 'UiPath Robot' -Force
      } else {
        $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden `
          -ArgumentList '-NoProfile -Command "Restart-Service -Name ''UiPath Robot'' -Force"'
        if ($p.ExitCode -ne 0) { throw "elevated restart exited with $($p.ExitCode)" }
      }
      Add-Step 'Restart Robot service' 'ok'
    } catch {
      Add-Step 'Restart Robot service' 'warning' $_.Exception.Message
    }
  }

  # 5. Start Assistant again.
  if ($spec.restartAssistant) {
    if ($spec.assistantPath -and (Test-Path -LiteralPath $spec.assistantPath)) {
      Start-Process -FilePath $spec.assistantPath
      Add-Step 'Start Assistant' 'ok'
    } else {
      Add-Step 'Start Assistant' 'warning' 'UiPath.Assistant.exe not found; start it manually'
    }
  }

  # 6. Optionally point the uip CLI at the same tenant.
  if ($spec.uip) {
    try {
      $secret = Get-Secret $spec.target
      $uipArgs = @('login', '--authority', $spec.uip.authority, '--client-id', $spec.target.clientId, '--client-secret', 'env.OC_UIP_CLIENT_SECRET', '--output', 'json')
      if ($spec.uip.organization) { $uipArgs += @('--organization', $spec.uip.organization) }
      if ($spec.uip.tenant) { $uipArgs += @('--tenant', $spec.uip.tenant) }
      $r = Invoke-Exe $spec.uip.path $uipArgs 120 @{ OC_UIP_CLIENT_SECRET = $secret }
      Add-Step 'Sync uip CLI login' $(if ($r.code -eq 0) { 'ok' } else { 'warning' }) "exit $($r.code) $($r.output)"
    } catch {
      Add-Step 'Sync uip CLI login' 'warning' $_.Exception.Message
    }
  }

  Finish $true "Connected to '$($spec.target.name)'."
} catch {
  Add-Step 'Unexpected error' 'failed' $_.Exception.Message
  Finish $false $_.Exception.Message
}

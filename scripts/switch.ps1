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
. (Join-Path $PSScriptRoot 'assistantSettings.ps1')

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
  if ($null -eq $s -or $s -eq '') { throw "No client secret is stored for preset '$($preset.name)'. Edit the preset and enter the client secret." }
  $secrets.Add($s)
  return $s
}

function Connect-Robot($preset, [string]$secret) {
  if (-not $secret) { throw "No client secret is stored for preset '$($preset.name)'." }
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

$assistantClosed = $false

try {
  Write-Log "Switching to '$($spec.target.name)' ($($spec.target.url))"
  Save-Status

  # 0. Read the secrets before anything changes: a missing target secret must not leave the Robot
  #    disconnected. A missing previous secret only rules out the rollback.
  try {
    $targetSecret = Get-Secret $spec.target
  } catch {
    Add-Step 'Read client secret' 'failed' $_.Exception.Message
    Finish $false "$($_.Exception.Message) The Robot was not changed."
  }
  $previousSecret = $null
  if ($spec.previous) {
    try { $previousSecret = Get-Secret $spec.previous } catch { Write-Log "No rollback possible: $($_.Exception.Message)" }
  }

  # 1. Close Assistant so it reconnects cleanly afterwards.
  if ($spec.restartAssistant) {
    $procs = @(Get-Process -Name 'UiPath.Assistant' -ErrorAction SilentlyContinue)
    if ($procs.Count -gt 0) {
      $procs | Stop-Process -Force -ErrorAction SilentlyContinue
      $procs | ForEach-Object { try { $_.WaitForExit(15000) | Out-Null } catch { } }
      $assistantClosed = $true
      Add-Step 'Close Assistant' 'ok' "$($procs.Count) process(es) closed"
    } else {
      Add-Step 'Close Assistant' 'skipped' 'Assistant was not running'
    }
  }

  # 1b. Turn off Assistant's Start menu shortcuts, if the user asked. Rewriting them for the new
  #     tenant can freeze Windows Explorer. Assistant must be closed, or it may overwrite the file.
  if ($spec.turnOffStartMenuShortcuts) {
    $step = 'Turn off Start menu shortcuts'
    if (@(Get-Process -Name 'UiPath.Assistant' -ErrorAction SilentlyContinue).Count -gt 0) {
      Add-Step $step 'warning' 'Assistant is still running, so its settings were not changed. Turn off Show in Windows Start Menu in Assistant > Preferences.'
    } else {
      try {
        switch (Disable-AssistantStartMenuShortcuts $spec.assistantSettingsPath) {
          'changed' { Add-Step $step 'ok' "Show in Windows Start Menu is now off in $($spec.assistantSettingsPath)" }
          'unchanged' { Add-Step $step 'skipped' 'Show in Windows Start Menu was already off' }
          default { Add-Step $step 'skipped' "No Assistant settings file at $($spec.assistantSettingsPath)" }
        }
      } catch {
        Add-Step $step 'warning' "Could not change Assistant's settings: $($_.Exception.Message) Turn off Show in Windows Start Menu in Assistant > Preferences."
      }
    }
  }

  # 2. Disconnect. A non-zero exit here usually means "already disconnected", so it is only a warning.
  #    Except while a process runs: UiRobot then refuses and the Robot stays connected, so a connect
  #    would only fail with "Orchestrator already connected!". Stop here and leave the Robot as it is.
  $r = Invoke-Exe $spec.uiRobotPath @('disconnect')
  if ($r.code -ne 0 -and $r.output -match 'processes running') {
    Add-Step 'Disconnect Robot' 'failed' "exit $($r.code) $($r.output)"
    $status.rolledBack = $true  # the Robot never left its tenant
    if ($assistantClosed -and $spec.assistantPath) { Start-Process -FilePath $spec.assistantPath -ErrorAction SilentlyContinue }
    $current = if ($spec.previous) { "'$($spec.previous.name)'" } else { 'its current tenant' }
    Finish $false "A process is running on the Robot, and UiRobot does not disconnect while a process runs, so the Robot is still connected to $current. Wait for the process to finish or stop it in UiPath Assistant, then switch again."
  }
  Add-Step 'Disconnect Robot' $(if ($r.code -eq 0) { 'ok' } else { 'warning' }) "exit $($r.code) $($r.output)"

  # 3. Connect to the target tenant, rolling back to the previous one on failure. An exception
  #    (UiRobot could not be started) counts as a failed connect, so it rolls back too.
  try {
    $r = Connect-Robot $spec.target $targetSecret
    $reason = ''
  } catch {
    $r = @{ code = -1; output = $_.Exception.Message }
    $reason = "UiRobot connect could not run ($($_.Exception.Message.TrimEnd('.')))."
  }
  if ($r.code -eq 0) {
    Add-Step 'Connect Robot' 'ok' $spec.target.url
  } else {
    Add-Step 'Connect Robot' 'failed' "exit $($r.code) $($r.output)"
    if (-not $reason) {
      $output = if ($r.output) { $r.output.TrimEnd('.') } else { 'no output' }
      $reason = "UiRobot connect returned exit code $($r.code) ($output)."
    }
    if ($spec.previous) {
      try {
        $rb = Connect-Robot $spec.previous $previousSecret
        if ($rb.code -eq 0) {
          $status.rolledBack = $true
          Add-Step "Reconnect previous ($($spec.previous.name))" 'ok' $spec.previous.url
          $reason += " Reconnected to '$($spec.previous.name)'."
        } else {
          Add-Step "Reconnect previous ($($spec.previous.name))" 'failed' "exit $($rb.code) $($rb.output)"
          $reason += " Reconnecting to '$($spec.previous.name)' also failed, so the Robot is disconnected."
        }
      } catch {
        Add-Step "Reconnect previous ($($spec.previous.name))" 'failed' $_.Exception.Message
        $reason += " Reconnecting to '$($spec.previous.name)' also failed, so the Robot is disconnected."
      }
    } else {
      $reason += ' No previously connected preset is known, so the Robot is disconnected.'
    }
    $reason += ' Check the machine client ID and secret in Orchestrator, then switch again.'
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
        if ($p.ExitCode -ne 0) { throw "The elevated service restart returned exit code $($p.ExitCode). Restart the UiPath Robot service manually." }
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
      Add-Step 'Start Assistant' 'warning' 'UiPath.Assistant.exe was not found. Start UiPath Assistant manually.'
    }
  }

  # 6. Optionally point the uip CLI at the same tenant.
  if ($spec.uip) {
    try {
      $uipArgs = @('login', '--authority', $spec.uip.authority, '--client-id', $spec.target.clientId, '--client-secret', 'env.OC_UIP_CLIENT_SECRET', '--output', 'json')
      if ($spec.uip.organization) { $uipArgs += @('--organization', $spec.uip.organization) }
      if ($spec.uip.tenant) { $uipArgs += @('--tenant', $spec.uip.tenant) }
      $r = Invoke-Exe $spec.uip.path $uipArgs 120 @{ OC_UIP_CLIENT_SECRET = $targetSecret }
      Add-Step 'Sync uip CLI login' $(if ($r.code -eq 0) { 'ok' } else { 'warning' }) "exit $($r.code) $($r.output)"
    } catch {
      Add-Step 'Sync uip CLI login' 'warning' $_.Exception.Message
    }
  }

  Finish $true "Connected to '$($spec.target.name)'."
} catch {
  Add-Step 'Unexpected error' 'failed' $_.Exception.Message
  # Don't leave the user without Assistant because of an error after it was closed.
  if ($assistantClosed -and $spec.assistantPath) { Start-Process -FilePath $spec.assistantPath -ErrorAction SilentlyContinue }
  Finish $false $_.Exception.Message
}

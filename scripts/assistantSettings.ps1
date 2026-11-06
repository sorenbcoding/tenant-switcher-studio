<#
  UiPath Assistant preferences (%AppData%\UiPath\agent-settings.json).

  Dot-source to get Disable-AssistantStartMenuShortcuts. With agent.showStartMenuShortcuts on,
  Assistant rewrites one Start menu shortcut per automation whenever it connects to another
  tenant, which can freeze Windows Explorer. The file belongs to Assistant: only call this while
  Assistant is closed, and only when the user asked for it.
#>

# Sets agent.showStartMenuShortcuts to false. Only that value changes; every other byte, including
# the encoding, stays as Assistant wrote it. Returns 'changed', 'unchanged' (already off or not
# present) or 'missing' (no file).
function Disable-AssistantStartMenuShortcuts([Parameter(Mandatory = $true)][string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return 'missing' }
  $bytes = [IO.File]::ReadAllBytes($Path)
  $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $text = [Text.Encoding]::UTF8.GetString($bytes, $(if ($bom) { 3 } else { 0 }), $bytes.Length - $(if ($bom) { 3 } else { 0 }))

  $pattern = '("showStartMenuShortcuts"\s*:\s*)true\b'
  if ($text -notmatch $pattern) { return 'unchanged' }
  $updated = [regex]::Replace($text, $pattern, '${1}false')
  $null = $updated | ConvertFrom-Json  # never leave Assistant with a file it cannot parse

  $tmp = "$Path.tmp"
  [IO.File]::WriteAllText($tmp, $updated, (New-Object System.Text.UTF8Encoding($bom)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
  return 'changed'
}

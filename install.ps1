# Installs or updates Quick Broadcast into %USERPROFILE%\quick-broadcast (Windows).
# Usage (PowerShell): irm https://raw.githubusercontent.com/Srekaravarshan/quick-broadcast/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$dest = Join-Path $HOME 'quick-broadcast'
$tmp = Join-Path $env:TEMP ("qb-" + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  $zip = Join-Path $tmp 'qb.zip'
  Invoke-WebRequest https://github.com/Srekaravarshan/quick-broadcast/archive/refs/heads/main.zip -OutFile $zip -UseBasicParsing
  Expand-Archive $zip $tmp -Force
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Move-Item (Join-Path $tmp 'quick-broadcast-main') $dest
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Quick Broadcast is ready in: $dest"
Write-Host "First time : chrome://extensions -> Developer mode ON -> Load unpacked -> pick that folder"
Write-Host "Updating   : chrome://extensions -> click the reload icon on Quick Broadcast"
Invoke-Item $dest

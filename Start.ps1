# GamezNET - First Run Setup
# Right-click this file and select "Run with PowerShell"

Write-Host ""
Write-Host "  +==========================================+" -ForegroundColor Cyan
Write-Host "  |           GAMEZNET INSTALLER              |" -ForegroundColor Cyan
Write-Host "  |     Private Game Server Network          |" -ForegroundColor Cyan
Write-Host "  +==========================================+" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Preparing files..." -ForegroundColor Yellow

# Unblock all files in this folder
Get-ChildItem -Path $PSScriptRoot -Recurse | Unblock-File

Write-Host "  Files unblocked successfully." -ForegroundColor Green
Write-Host "  Launching setup..." -ForegroundColor Yellow
Write-Host ""

# Launch setup.bat as administrator
Start-Process -FilePath "$PSScriptRoot\setup.bat" -Verb RunAs

# GamezNET Remote Assistance - Helper Side PoC
# Run this on the machine that is GIVING help (Player B)
# Usage: .\test-helper.ps1 -TargetID <rustdesk_id> -Password <session_pass>
# Or run without args to be prompted

param(
    [string]$TargetID = "",
    [string]$Password = ""
)

$ErrorActionPreference = 'Stop'

$RUSTDESK_EXE = "$env:LOCALAPPDATA\GamezNET\rustdesk.exe"
$RUSTDESK_URL = "https://github.com/rustdesk/rustdesk/releases/download/1.4.6/rustdesk-1.4.6-x86_64.exe"

Write-Host "=== GamezNET Remote Assistance (HELPER) ===" -ForegroundColor Cyan

if (-not $TargetID) { $TargetID = Read-Host "Enter target RustDesk ID" }
if (-not $Password) { $Password = Read-Host "Enter session password" }

# --- Download RustDesk if not cached
if (-not (Test-Path $RUSTDESK_EXE)) {
    Write-Host "Downloading RustDesk (one-time)..." -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path (Split-Path $RUSTDESK_EXE) | Out-Null
    Invoke-WebRequest -Uri $RUSTDESK_URL -OutFile $RUSTDESK_EXE -UseBasicParsing
    Write-Host "Downloaded." -ForegroundColor Green
} else {
    Write-Host "RustDesk ready." -ForegroundColor Gray
}

# --- Attempt CLI connection
Write-Host "Attempting connection to $TargetID..." -ForegroundColor Gray
$proc = Start-Process -FilePath $RUSTDESK_EXE -ArgumentList "--connect $TargetID --password $Password" -PassThru
Start-Sleep -Seconds 5

if ($proc.HasExited) {
    # CLI connect didn't work — fall back to GUI with credentials printed
    Write-Host "--connect flag not supported, launching GUI..." -ForegroundColor Yellow
    Start-Process $RUSTDESK_EXE
    Write-Host ""
    Write-Host "Connect manually in the RustDesk window:" -ForegroundColor White
    Write-Host "  ID      : $TargetID" -ForegroundColor White
    Write-Host "  Password: $Password" -ForegroundColor White
} else {
    Write-Host "Connection opened." -ForegroundColor Green
}

Write-Host ""
Write-Host "Press Enter when the session is done..." -ForegroundColor Yellow
Read-Host

# --- Stop RustDesk (exe stays cached)
Stop-Process -Name rustdesk -Force -ErrorAction SilentlyContinue
Write-Host "Session ended. RustDesk stopped." -ForegroundColor Green

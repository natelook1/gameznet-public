# GamezNET Remote Assistance - Host Side PoC
# Run this on the machine that WANTS help (Player A)
# RustDesk is cached at $env:LOCALAPPDATA\GamezNET\rustdesk.exe — downloaded once, never deleted except on uninstall

$ErrorActionPreference = 'Stop'

$RUSTDESK_EXE = "$env:LOCALAPPDATA\GamezNET\rustdesk.exe"
$RUSTDESK_URL = "https://github.com/rustdesk/rustdesk/releases/download/1.4.6/rustdesk-1.4.6-x86_64.exe"
$RUSTDESK_CONFIG = "$env:APPDATA\RustDesk\config\RustDesk.toml"
$RUSTDESK_ID_LOG = "$env:APPDATA\RustDesk\log\get-id\rustdesk_rCURRENT.log"

# --- Generate a session password (in production: derived server-side from VPN key + timestamp)
$SESSION_SEED = "gameznet-$(Get-Date -Format 'yyyyMMddHH')"
$SESSION_PASS = ([System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($SESSION_SEED)
    )
) -replace '-','').Substring(0,16)

Write-Host "=== GamezNET Remote Assistance (HOST) ===" -ForegroundColor Cyan

# --- Download RustDesk if not cached
if (-not (Test-Path $RUSTDESK_EXE)) {
    Write-Host "Downloading RustDesk (one-time)..." -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path (Split-Path $RUSTDESK_EXE) | Out-Null
    Invoke-WebRequest -Uri $RUSTDESK_URL -OutFile $RUSTDESK_EXE -UseBasicParsing
    Write-Host "Downloaded." -ForegroundColor Green
} else {
    Write-Host "RustDesk ready." -ForegroundColor Gray
}

# --- Write session password to config before starting (RustDesk hashes it on startup)
New-Item -ItemType Directory -Force -Path (Split-Path $RUSTDESK_CONFIG) | Out-Null
if (Test-Path $RUSTDESK_CONFIG) {
    (Get-Content $RUSTDESK_CONFIG) -replace "password = '.*'", "password = '$SESSION_PASS'" |
        Set-Content $RUSTDESK_CONFIG
} else {
    "enc_id = ''`npassword = '$SESSION_PASS'`nsalt = ''`n" | Set-Content $RUSTDESK_CONFIG
}

# --- Start RustDesk and get ID
Write-Host "Starting RustDesk..." -ForegroundColor Gray
Start-Process $RUSTDESK_EXE
Start-Sleep -Seconds 4

# --- Run --get-id to populate the log
& $RUSTDESK_EXE --get-id | Out-Null
Start-Sleep -Seconds 2

# --- Read ID from log
$RUSTDESK_ID = (Get-Content $RUSTDESK_ID_LOG |
    Select-String "Generated id" |
    Select-Object -Last 1) -replace '.*Generated id (\d+).*','$1'

# --- Get VPN IP
$VPN_IP = ((Get-NetIPAddress -AddressFamily IPv4) |
    Where-Object { $_.IPAddress -like '192.168.8.*' }).IPAddress

Write-Host ""
Write-Host "=== SHARE THIS WITH YOUR HELPER ===" -ForegroundColor Green
Write-Host "RustDesk ID : $RUSTDESK_ID" -ForegroundColor White
Write-Host "Password    : $SESSION_PASS" -ForegroundColor White
Write-Host "VPN IP      : $VPN_IP" -ForegroundColor White
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Enter when the session is done..." -ForegroundColor Yellow
Read-Host

# --- Clear password from config on session end (RustDesk stays installed)
(Get-Content $RUSTDESK_CONFIG) -replace "password = '.*'", "password = ''" |
    Set-Content $RUSTDESK_CONFIG
Stop-Process -Name rustdesk -Force -ErrorAction SilentlyContinue
Write-Host "Session ended. RustDesk stopped, password cleared." -ForegroundColor Green

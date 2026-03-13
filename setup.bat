@echo off
chcp 437 >nul
setlocal EnableDelayedExpansion
title GameNet Setup

echo.
echo  +==========================================+
echo  ^|          GAMENET SETUP v1.0              ^|
echo  ^|     Private Game Server Network          ^|
echo  +==========================================+
echo.

:: Check for admin rights
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo  [!] Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "INSTALL_DIR=%~dp0"
set "PYTHON_MIN_VER=3.9"

echo  [1/4] Checking Python installation...

:: Check if Python 3.9+ is available
python --version >nul 2>&1
if %errorLevel% EQU 0 (
    for /f "tokens=2" %%V in ('python --version 2^>^&1') do set "PY_VER=%%V"
    echo        Found Python !PY_VER!
    goto :install_deps
)

:: Python not found — download and install silently
echo  [!] Python not found. Downloading Python 3.12...
echo.

set "PY_INSTALLER=%TEMP%\python-installer.exe"
set "PY_URL=https://www.python.org/ftp/python/3.12.3/python-3.12.3-amd64.exe"

powershell -Command "& { $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PY_INSTALLER%' }"

if not exist "%PY_INSTALLER%" (
    echo  [!] ERROR: Failed to download Python. Check your internet connection.
    pause
    exit /b 1
)

echo        Installing Python silently (this may take a minute)...
"%PY_INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1

:: Refresh PATH
call RefreshEnv.cmd >nul 2>&1
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"

:: Verify
python --version >nul 2>&1
if %errorLevel% NEQ 0 (
    echo  [!] ERROR: Python installation failed. Please install Python 3.9+ manually from python.org
    pause
    exit /b 1
)
echo        Python installed successfully!

:install_deps
echo.
echo  [2/4] Installing dependencies...

python -m pip install --upgrade pip --quiet --no-warn-script-location
python -m pip install flask requests --quiet --no-warn-script-location

if %errorLevel% NEQ 0 (
    echo  [!] ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

echo        Dependencies installed!

:: ── Check for wireguard.exe ──────────────────────────────────────────────────
echo.
echo  [3/4] Checking WireGuard...

if exist "%INSTALL_DIR%wireguard.exe" (
    echo        wireguard.exe found in app folder.
) else (
    :: Check if WireGuard is installed system-wide
    if exist "C:\Program Files\WireGuard\wireguard.exe" (
        echo        WireGuard found at Program Files.
        copy "C:\Program Files\WireGuard\wireguard.exe" "%INSTALL_DIR%wireguard.exe" >nul
    ) else (
        echo.
        echo  [!] WireGuard is not installed.
        echo      Downloading WireGuard installer...
        set "WG_INSTALLER=%TEMP%\wireguard-installer.exe"
        powershell -Command "& { $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://download.wireguard.com/windows-client/wireguard-installer.exe' -OutFile '%TEMP%\wireguard-installer.exe' }"
        if exist "%TEMP%\wireguard-installer.exe" (
            echo      Installing WireGuard...
            "%TEMP%\wireguard-installer.exe" /quiet
            timeout /t 5 /nobreak >nul
            if exist "C:\Program Files\WireGuard\wireguard.exe" (
                copy "C:\Program Files\WireGuard\wireguard.exe" "%INSTALL_DIR%wireguard.exe" >nul
                echo        WireGuard installed!
            ) else (
                echo  [!] Could not auto-install WireGuard. Please install from https://www.wireguard.com/install/
            )
        ) else (
            echo  [!] Could not download WireGuard. Please install manually from https://www.wireguard.com/install/
        )
    )
)

:: ── Create desktop shortcut ──────────────────────────────────────────────────
echo.
echo  [4/4] Creating desktop shortcut...

set "SHORTCUT=%USERPROFILE%\Desktop\GameNet.lnk"
set "LAUNCHER=%INSTALL_DIR%GameNet.bat"

powershell -Command "& { $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%LAUNCHER%'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'GameNet - Private Game Server Network'; $s.Save() }"

echo        Desktop shortcut created: GameNet

echo.
echo  +==========================================+
echo  ^|         Setup Complete!                  ^|
echo  ^|                                          ^|
echo  ^|  Double-click GameNet on your desktop    ^|
echo  ^|  to launch. Enter your invite token      ^|
echo  ^|  on first run.                           ^|
echo  +==========================================+
echo.

pause

@echo off
setlocal
title GamezNET

:: ─────────────────────────────────────────────────────────────────────────────
::  GamezNET Launcher / Upgrade Bridge
::  If the new GamezNET.exe is already installed, launch it and exit.
::  Otherwise download the installer, install silently, then launch the exe.
:: ─────────────────────────────────────────────────────────────────────────────

:: Request admin if not already elevated (needed for WireGuard install)
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b
)

set "EXE_PATH=%LOCALAPPDATA%\GamezNET\GamezNET.exe"
set "INSTALLER_URL=https://github.com/natelook1/gameznet-public/releases/latest/download/GamezNET-Setup.exe"
set "INSTALLER_TMP=%TEMP%\GamezNET-Setup.exe"

:: ── Already installed? Just run it. ──────────────────────────────────────────
if exist "%EXE_PATH%" (
    start "" "%EXE_PATH%"
    exit /b
)

:: ── Not installed — download and run the installer silently ──────────────────
echo Upgrading GamezNET — this will only take a moment...

powershell -NoProfile -Command ^
    "Invoke-WebRequest -Uri '%INSTALLER_URL%' -OutFile '%INSTALLER_TMP%' -UseBasicParsing"

if not exist "%INSTALLER_TMP%" (
    echo [!] Download failed. Visit https://gameznet.looknet.ca to install manually.
    pause
    exit /b 1
)

:: Run silently and wait — installer creates the exe and desktop shortcut
"%INSTALLER_TMP%" /VERYSILENT /NORESTART
del /f /q "%INSTALLER_TMP%" >nul 2>&1

:: Launch the freshly installed exe
if exist "%EXE_PATH%" (
    start "" "%EXE_PATH%"
) else (
    echo [!] Install completed but GamezNET.exe not found at expected location.
    echo     Check %LOCALAPPDATA%\GamezNET\
    pause
)

exit /b

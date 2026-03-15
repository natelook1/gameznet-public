@echo off
setlocal
title GamezNET

:: ─────────────────────────────────────────────
::  GamezNET Launcher
::  Run this daily to connect to the game server
:: ─────────────────────────────────────────────

set "INSTALL_DIR=%~dp0"

:: Request admin if not already (needed for WireGuard)
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs -WorkingDirectory '%INSTALL_DIR%'"
    exit /b
)

:: Verify Python - try multiple methods
set "PY_CMD="
python --version >nul 2>&1
if %errorLevel% EQU 0 set "PY_CMD=python"

if not defined PY_CMD (
    py -3 --version >nul 2>&1
    if %errorLevel% EQU 0 set "PY_CMD=py -3"
)

if not defined PY_CMD (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
        if exist "%%D\python.exe" set "PY_CMD=%%D\python.exe"
    )
)

if not defined PY_CMD (
    echo [!] Python not found. Please re-run the GamezNET installer.
    echo     irm https://gameznet.looknet.ca/install ^| iex
    pause
    exit /b 1
)

:: Kill any existing GamezNET server running on our port
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":7734 " 2^>nul') do (
    taskkill /F /PID %%P >nul 2>&1
)

:: Start the app — Python will hide the console and show a tray icon
cd /d "%INSTALL_DIR%"
start "GamezNET" /min %PY_CMD% app.py

exit /b
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

:: Bring Python into PATH (handles both installed and local)
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"

:: Verify Python
python --version >nul 2>&1
if %errorLevel% NEQ 0 (
    echo [!] Python not found. Please run setup.bat first.
    pause
    exit /b 1
)

:: Kill any existing GamezNET server on that port
for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":7734 " 2^>nul') do (
    taskkill /F /PID %%P >nul 2>&1
)

:: Start the Flask server (minimized console window)
cd /d "%INSTALL_DIR%"
start "GamezNET Server" /min python app.py

exit /b

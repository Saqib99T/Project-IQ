@echo off
echo ========================================
echo Restarting Admin API Server
echo ========================================
echo.

cd /d "%~dp0"

REM Ensure Log directory exists
if not exist "Log" mkdir Log

echo Stopping Admin API (port 80)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":80 " ^| findstr "LISTENING"') do (
    echo Stopping PID: %%a
    taskkill /F /PID %%a 2>nul
)

echo Waiting 3 seconds...
timeout /t 3 /nobreak >nul

echo.
echo Starting Admin API...
start "Admin API" cmd /k "title Admin API && cd actions && python admin_api.py >> ..\Log\admin.log 2>&1"

echo Waiting 5 seconds for Admin API to start...
timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo Admin API Restarted!
echo ========================================
echo.
echo Now open: http://localhost/admin.html
echo Press Ctrl+F5 to force refresh
echo.
echo Look for "Knowledge Base" tab in the sidebar
echo (Should have a blue "New" badge)
echo.
pause

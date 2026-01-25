@echo off
echo ========================================
echo Restarting Project IQ Services
echo ========================================
echo.

echo [1/4] Stopping existing services...
echo Stopping Admin API (port 80)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":80 " ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul

echo Stopping Rasa Core (port 5005)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5005 " ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul

echo Stopping Action Server (port 5055)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5055 " ^| findstr "LISTENING"') do taskkill /F /PID %%a 2>nul

echo.
echo Waiting 3 seconds for services to stop...
timeout /t 3 /nobreak >nul

echo.
echo [2/4] Starting Action Server (port 5055)...
start "Action Server" cmd /k "cd /d %~dp0 && python -m rasa_sdk --actions actions -p 5055"

echo Waiting 5 seconds for Action Server to initialize...
timeout /t 5 /nobreak >nul

echo.
echo [3/4] Starting Admin API (port 80)...
start "Admin API" cmd /k "cd /d %~dp0actions && python admin_api.py"

echo Waiting 3 seconds for Admin API to initialize...
timeout /t 3 /nobreak >nul

echo.
echo [4/4] Starting Rasa Core (port 5005)...
start "Rasa Core" cmd /k "cd /d %~dp0 && rasa run --enable-api --cors * --port 5005 --endpoints endpoints.yml"

echo.
echo ========================================
echo Services Restart Complete!
echo ========================================
echo.
echo Please check the new windows that opened:
echo   1. Action Server (port 5055) - Should show "KB cache refresh thread started"
echo   2. Admin API (port 80)
echo   3. Rasa Core (port 5005)
echo.
echo Visit http://localhost/admin.html and go to Knowledge Base tab
echo.
pause

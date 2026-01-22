@echo off
echo ========================================
echo   Project-IQ Health Check
echo ========================================
echo.

set ERROR_COUNT=0

REM Check Rasa Core
echo [1/3] Checking Rasa Core (Port 5005)...
curl -s -o nul -w "%%{http_code}" http://localhost:5005/status > temp_status.txt
set /p STATUS=<temp_status.txt
if "%STATUS%"=="200" (
    echo     [OK] Rasa Core is healthy
) else (
    echo     [FAIL] Rasa Core is not responding
    set /a ERROR_COUNT+=1
)
del temp_status.txt >nul 2>&1

REM Check Actions Server
echo [2/3] Checking Actions Server (Port 5055)...
curl -s -o nul -w "%%{http_code}" http://localhost:5055/health > temp_status.txt
set /p STATUS=<temp_status.txt
if "%STATUS%"=="200" (
    echo     [OK] Actions Server is healthy
) else (
    echo     [FAIL] Actions Server is not responding
    set /a ERROR_COUNT+=1
)
del temp_status.txt >nul 2>&1

REM Check Admin Dashboard
echo [3/3] Checking Admin Dashboard (Port 80)...
curl -s -o nul -w "%%{http_code}" http://localhost:80/admin/health/rasa > temp_status.txt
set /p STATUS=<temp_status.txt
if "%STATUS%"=="200" (
    echo     [OK] Admin Dashboard is healthy
) else (
    echo     [FAIL] Admin Dashboard is not responding
    set /a ERROR_COUNT+=1
)
del temp_status.txt >nul 2>&1

echo.
echo ========================================
if %ERROR_COUNT%==0 (
    echo   All Services: HEALTHY
    echo ========================================
) else (
    echo   %ERROR_COUNT% Service(s): FAILED
    echo ========================================
    echo.
    echo Troubleshooting:
    echo 1. Check if services are running: netstat -ano ^| findstr ":5005 :5055 :80"
    echo 2. Check logs in Log\ directory
    echo 3. Try restarting services with start_services.bat
)
echo.
pause

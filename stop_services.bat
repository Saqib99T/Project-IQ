@echo off
echo ========================================
echo   Stopping Project-IQ Services
echo ========================================
echo.

REM Find and kill Rasa Core process
echo Stopping Rasa Core Server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5005" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    if not errorlevel 1 (
        echo [OK] Rasa Core stopped
    )
)

REM Find and kill Actions Server process
echo Stopping Actions Server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5055" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    if not errorlevel 1 (
        echo [OK] Actions Server stopped
    )
)

REM Find and kill Admin API process
echo Stopping Admin Dashboard...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":80 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    if not errorlevel 1 (
        echo [OK] Admin Dashboard stopped
    )
)

echo.
echo All services stopped.
echo.
pause

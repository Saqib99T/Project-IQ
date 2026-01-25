@echo off
echo Stopping Admin API...
taskkill /F /IM python.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Admin API with dual directory support...
cd /d "%~dp0actions"
start "Admin API" cmd /k "python admin_api.py"

timeout /t 3 /nobreak >nul
echo.
echo Admin API restarted!
echo.
echo Widget should now be visible at:
echo   http://localhost/it.html
echo   http://localhost/acc.html
echo.
echo Admin panel at:
echo   http://localhost/admin.html
echo.
pause

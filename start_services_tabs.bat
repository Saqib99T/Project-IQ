@echo off
echo Starting Project-IQ Services in Windows Terminal Tabs...

if not exist "venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found!
    pause
    exit /b 1
)

REM Ensure Log directory exists
if not exist "Log" mkdir Log

REM Check if wt.exe is available
where wt >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Windows Terminal (wt.exe) not found. Falling back to separate windows.
    call start_services.bat
    exit /b
)

REM Launch using wt
wt -w 0 new-tab --title "Rasa Core" -d "%~dp0." cmd /k "venv\Scripts\activate && rasa run --enable-api --cors * --port 5005 >> Log\core.log 2>&1" ; new-tab --title "Actions Server" -d "%~dp0." cmd /k "venv\Scripts\activate && python -m rasa_sdk --actions actions -p 5055 --auto-reload >> Log\actions.log 2>&1" ; new-tab --title "Admin Dashboard" -d "%~dp0actions" cmd /k "..\venv\Scripts\activate && python admin_api.py >> ..\Log\admin.log 2>&1"

echo Services launched in Windows Terminal!

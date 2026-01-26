@echo off
echo ========================================
echo   Project-IQ Service Launcher
echo ========================================
echo.

REM Check if virtual environment exists
if not exist "venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found!
    echo Please run: python -m venv venv
    echo Then install requirements: pip install -r requirements.txt
    pause
    exit /b 1
)

echo Starting services...
echo.

REM Start Rasa Core Server
echo [1/3] Starting Rasa Core Server (Port 5005)...
start "Rasa Core Server" cmd /k "cd /d %~dp0 && venv\Scripts\activate && rasa run --enable-api --cors * --port 5005"

REM Wait for Rasa to initialize
timeout /t 8 /nobreak >nul

REM Start Actions Server
echo [2/3] Starting Actions Server (Port 5055)...
start "Actions Server" cmd /k "cd /d %~dp0 && venv\Scripts\activate && python -m rasa_sdk --actions actions -p 5055 --auto-reload --num-workers 4"

REM Wait for Actions Server
timeout /t 5 /nobreak >nul

REM Start Admin API Server
echo [3/3] Starting Admin Dashboard (Port 80)...
start "Admin Dashboard" cmd /k "cd /d %~dp0 && venv\Scripts\activate && cd actions && python admin_api.py"

echo.
echo ========================================
echo   All Services Started Successfully!
echo ========================================
echo.
echo Service URLs:
echo - Admin Dashboard:  http://localhost:80
echo - Rasa Core:        http://localhost:5005
echo - Actions Server:   http://localhost:5055
echo.
echo Press any key to open Admin Dashboard in browser...
pause >nul

REM Open browser
start http://localhost:80

echo.
echo Services are running in separate windows.
echo Close those windows to stop the services.
echo.
pause

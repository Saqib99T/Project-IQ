@echo off
color 0A
echo ========================================
echo   Project-IQ Setup Wizard
echo ========================================
echo.
echo This script will help you set up the application.
echo.
pause

REM Step 1: Check Python
echo.
echo [Step 1/6] Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Python not found!
    echo Please install Python 3.8-3.10 from https://www.python.org/
    pause
    exit /b 1
)
python --version
echo [OK] Python found

REM Step 2: Create Virtual Environment
echo.
echo [Step 2/6] Creating virtual environment...
if exist "venv" (
    echo Virtual environment already exists. Skipping...
) else (
    python -m venv venv
    if errorlevel 1 (
        echo [FAIL] Failed to create virtual environment
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created
)

REM Step 3: Activate and Install Dependencies
echo.
echo [Step 3/6] Installing dependencies...
echo This may take 10-15 minutes...
call venv\Scripts\activate.bat

echo Upgrading pip...
python -m pip install --upgrade pip

echo Installing Rasa...
pip install rasa==3.6.20

echo Installing other requirements...
pip install -r requirements.txt

if errorlevel 1 (
    echo [FAIL] Failed to install dependencies
    pause
    exit /b 1
)
echo [OK] Dependencies installed

REM Step 4: Check PostgreSQL
echo.
echo [Step 4/6] Checking PostgreSQL...
psql --version >nul 2>&1
if errorlevel 1 (
    echo [WARN] PostgreSQL not found in PATH
    echo Please ensure PostgreSQL is installed
    echo You can continue and configure database later
    pause
) else (
    psql --version
    echo [OK] PostgreSQL found
)

REM Step 5: Create Log Directory
echo.
echo [Step 5/6] Creating directories...
if not exist "Log" mkdir Log
if not exist "backups" mkdir backups
if not exist "models" mkdir models
echo [OK] Directories created

REM Step 6: Train Initial Model
echo.
echo [Step 6/6] Training initial Rasa model...
set /p TRAIN="Would you like to train the model now? (Y/N): "
if /i "%TRAIN%"=="Y" (
    echo Training... This may take 5-10 minutes...
    rasa train
    if errorlevel 1 (
        echo [WARN] Training failed or was interrupted
        echo You can train later using: rasa train
    ) else (
        echo [OK] Model trained successfully
    )
) else (
    echo Skipping model training
    echo You can train later using: rasa train
)

REM Complete
echo.
echo ========================================
echo   Setup Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Configure database in actions\conversation_db.py
echo 2. Update endpoints.yml with database credentials
echo 3. Configure GLPI in app.config (optional)
echo 4. Run start_services.bat to start all services
echo.
echo For detailed instructions, see DEPLOYMENT_GUIDE.md
echo.
pause

REM Ask to start services
echo.
set /p START="Would you like to start services now? (Y/N): "
if /i "%START%"=="Y" (
    call start_services.bat
) else (
    echo.
    echo Setup complete. Run start_services.bat when ready.
    pause
)

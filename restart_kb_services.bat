@echo off
setlocal enabledelayedexpansion
color 0A

echo.
echo ============================================================
echo   PROJECT IQ - KNOWLEDGE BASE INTEGRATION RESTART
echo ============================================================
echo.

cd /d "%~dp0"

echo [STEP 1/5] Stopping running services...
echo ------------------------------------------------------------

REM Stop all Python processes gracefully
echo Stopping all Python services...
taskkill /F /IM python.exe 2>nul
if %errorlevel% equ 0 (
    echo    - Python processes stopped
) else (
    echo    - No Python processes found
)

REM Wait for processes to fully terminate
echo Waiting 5 seconds for processes to terminate...
timeout /t 5 /nobreak >nul

REM Verify ports are free
echo Checking if ports are free...
netstat -ano | findstr ":5005 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo    WARNING: Port 5005 still in use
) else (
    echo    - Port 5005 is free
)

netstat -ano | findstr ":5055 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo    WARNING: Port 5055 still in use
) else (
    echo    - Port 5055 is free
)

netstat -ano | findstr ":80 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo    WARNING: Port 80 still in use
) else (
    echo    - Port 80 is free
)

echo.
echo [STEP 2/5] Installing/Verifying dependencies...
echo ------------------------------------------------------------

REM Check if sentence-transformers is installed
python -c "import sentence_transformers" 2>nul
if %errorlevel% neq 0 (
    echo Installing sentence-transformers (this may take 5-10 minutes)...
    echo This will download ~750MB of packages...
    pip install sentence-transformers==2.3.1
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: Failed to install sentence-transformers
        echo Please run manually: pip install sentence-transformers==2.3.1
        pause
        exit /b 1
    )
    echo    - sentence-transformers installed successfully
) else (
    echo    - sentence-transformers already installed
)

REM Verify KB cache manager exists
if exist "actions\kb_cache_manager.py" (
    echo    - kb_cache_manager.py found
) else (
    echo    ERROR: kb_cache_manager.py not found!
    echo    Please ensure all files are deployed correctly.
    pause
    exit /b 1
)

REM Verify app.config has KB section
findstr /C:"[KNOWLEDGE_BASE]" app.config >nul
if %errorlevel% equ 0 (
    echo    - app.config has KB configuration
) else (
    echo    WARNING: app.config missing [KNOWLEDGE_BASE] section
)

echo.
echo [STEP 3/5] Starting Action Server with KB Cache...
echo ------------------------------------------------------------
echo Starting Action Server on port 5055...
echo IMPORTANT: Watch for KB cache initialization messages
echo.

start "Project IQ - Action Server" cmd /k "title Project IQ - Action Server && echo ================================================ && echo    ACTION SERVER WITH KB CACHE MANAGER && echo ================================================ && echo. && python -m rasa_sdk --actions actions -p 5055"

echo Waiting 10 seconds for Action Server to initialize...
echo (Watch the Action Server window for KB cache messages)
timeout /t 10 /nobreak

REM Verify Action Server is running
netstat -ano | findstr ":5055 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo    [OK] Action Server is running on port 5055
) else (
    echo    [ERROR] Action Server failed to start!
    echo    Check the Action Server window for errors
    pause
    exit /b 1
)

echo.
echo [STEP 4/5] Starting Admin API...
echo ------------------------------------------------------------
echo Starting Admin API on port 80...
echo.

start "Project IQ - Admin API" cmd /k "title Project IQ - Admin API && echo ================================================ && echo    ADMIN API SERVER && echo ================================================ && echo. && cd actions && python admin_api.py"

echo Waiting 5 seconds for Admin API to initialize...
timeout /t 5 /nobreak

REM Verify Admin API is running
netstat -ano | findstr ":80 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo    [OK] Admin API is running on port 80
) else (
    echo    [WARNING] Admin API may not have started
    echo    Check the Admin API window for errors
)

echo.
echo [STEP 5/5] Starting Rasa Core (Optional)...
echo ------------------------------------------------------------

REM Check if Rasa is already running before we stopped it
choice /C YN /M "Do you want to start Rasa Core (port 5005)"
if errorlevel 2 goto skip_rasa
if errorlevel 1 goto start_rasa

:start_rasa
echo Starting Rasa Core on port 5005...
echo.

start "Project IQ - Rasa Core" cmd /k "title Project IQ - Rasa Core && echo ================================================ && echo    RASA CORE && echo ================================================ && echo. && rasa run --enable-api --cors * --port 5005 --endpoints endpoints.yml"

echo Waiting 8 seconds for Rasa Core to initialize...
timeout /t 8 /nobreak

REM Verify Rasa is running
netstat -ano | findstr ":5005 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo    [OK] Rasa Core is running on port 5005
) else (
    echo    [WARNING] Rasa Core may not have started
    echo    Check the Rasa Core window for errors
)
goto after_rasa

:skip_rasa
echo Skipping Rasa Core startup
echo.

:after_rasa

echo.
echo ============================================================
echo   RESTART COMPLETE!
echo ============================================================
echo.
echo Services Status:
echo   - Action Server:  Port 5055  (Check window for KB messages)
echo   - Admin API:      Port 80
echo   - Rasa Core:      Port 5005  (if started)
echo.
echo IMPORTANT: Check the Action Server window for these messages:
echo   [KB Cache] Initializing Knowledge Base cache manager...
echo   [KB Cache] Loading sentence transformer model...
echo   [KB Cache] Fetching articles from GLPI...
echo   KB cache refreshed: X articles loaded
echo   [KB Cache] KB cache refresh thread started
echo.
echo If you see these messages, KB integration is working!
echo.
echo Next Steps:
echo   1. Open browser: http://localhost/admin.html
echo   2. Click on "Knowledge Base" tab (has "New" badge)
echo   3. Verify article count and GLPI KB source
echo   4. Try the search tester with queries like "password reset"
echo.
echo If you don't see KB messages in Action Server:
echo   - Check admin_new.err or Log/actions.log for errors
echo   - Verify sentence-transformers installed: pip show sentence-transformers
echo   - Verify kb_cache_manager.py exists in actions folder
echo.
pause

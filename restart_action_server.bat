@echo off
echo ========================================
echo Restarting Action Server with KB Cache
echo ========================================
echo.

cd /d "%~dp0"

echo Stopping Action Server (port 5055)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5055 " ^| findstr "LISTENING"') do (
    echo Stopping PID: %%a
    taskkill /F /PID %%a 2>nul
)

echo Waiting 3 seconds...
timeout /t 3 /nobreak >nul

echo.
echo Starting Action Server with KB Cache Manager...
echo.
echo WATCH THIS WINDOW FOR KB CACHE MESSAGES:
echo ==========================================
echo.

start "Action Server with KB" cmd /k "title Action Server with KB Cache && python -m rasa_sdk --actions actions -p 5055"

echo.
echo ========================================
echo Action Server restarted!
echo ========================================
echo.
echo Look for these messages in the new window:
echo   [KB Cache] Initializing Knowledge Base cache manager...
echo   [KB Cache] Loading sentence transformer model...
echo   [KB Cache] Fetching articles from GLPI...
echo   KB cache refreshed: X articles loaded
echo   [KB Cache] KB cache refresh thread started
echo.
echo If you see "Falling back to JSON KB files" instead:
echo   - GLPI may be unreachable
echo   - KB will use local JSON files (95 articles)
echo   - This is normal fallback behavior
echo.
pause

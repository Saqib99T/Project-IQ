@echo off
echo ========================================
echo   Database Backup Script
echo ========================================
echo.

REM Configuration
set BACKUP_DIR=%~dp0backups
set DB_NAME=rasa_conversations
set DB_USER=postgres
set PG_BIN="C:\Program Files\PostgreSQL\18\bin"

REM Create timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,8%_%datetime:~8,6%

REM Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM Check if PostgreSQL bin exists
if not exist %PG_BIN%\pg_dump.exe (
    echo ERROR: PostgreSQL not found at %PG_BIN%
    echo Please update PG_BIN path in this script
    pause
    exit /b 1
)

echo Creating backup...
echo Database: %DB_NAME%
echo Timestamp: %TIMESTAMP%
echo Location: %BACKUP_DIR%
echo.

REM Create backup
%PG_BIN%\pg_dump.exe -U %DB_USER% -d %DB_NAME% -F c -f "%BACKUP_DIR%\backup_%TIMESTAMP%.backup"

if errorlevel 1 (
    echo.
    echo [FAIL] Backup failed!
    echo Check if:
    echo - PostgreSQL service is running
    echo - Database name is correct
    echo - User has permission
    pause
    exit /b 1
)

echo.
echo [OK] Backup completed successfully!
echo File: backup_%TIMESTAMP%.backup
echo.

REM Delete backups older than 30 days
echo Cleaning old backups (older than 30 days)...
forfiles /p "%BACKUP_DIR%" /m *.backup /d -30 /c "cmd /c del @path" >nul 2>&1
echo Done.

echo.
echo ========================================
echo   Backup Complete
echo ========================================
echo.

REM List recent backups
echo Recent backups:
dir /b /o-d "%BACKUP_DIR%\*.backup" | findstr /n "^" | findstr /b "1: 2: 3: 4: 5:"

echo.
pause

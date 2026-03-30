@echo off
echo ========================================
echo   Database Restore Script
echo ========================================
echo.

REM Configuration
set BACKUP_DIR=%~dp0backups
set DB_NAME=Chatbot
set DB_USER=postgres
set PG_BIN="C:\Program Files\PostgreSQL\18\bin"

REM Check if backup directory exists
if not exist "%BACKUP_DIR%" (
    echo ERROR: Backup directory not found: %BACKUP_DIR%
    pause
    exit /b 1
)

REM List available backups
echo Available backups:
echo.
dir /b /o-d "%BACKUP_DIR%\*.backup"
echo.

REM Ask for backup file
set /p BACKUP_FILE="Enter backup filename (or full path): "

REM Check if file exists
if not exist "%BACKUP_DIR%\%BACKUP_FILE%" (
    if not exist "%BACKUP_FILE%" (
        echo ERROR: Backup file not found!
        pause
        exit /b 1
    )
    set FULL_PATH=%BACKUP_FILE%
) else (
    set FULL_PATH=%BACKUP_DIR%\%BACKUP_FILE%
)

echo.
echo WARNING: This will drop and recreate the database!
echo All current data will be lost!
echo.
set /p CONFIRM="Are you sure? Type YES to continue: "

if not "%CONFIRM%"=="YES" (
    echo Restore cancelled.
    pause
    exit /b 0
)

echo.
echo Restoring database...

REM Drop existing connections
%PG_BIN%\psql.exe -U %DB_USER% -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='%DB_NAME%' AND pid <> pg_backend_pid();" >nul 2>&1

REM Drop and recreate database
%PG_BIN%\psql.exe -U %DB_USER% -c "DROP DATABASE IF EXISTS %DB_NAME%;" >nul 2>&1
%PG_BIN%\psql.exe -U %DB_USER% -c "CREATE DATABASE %DB_NAME%;"

if errorlevel 1 (
    echo [FAIL] Failed to recreate database
    pause
    exit /b 1
)

REM Restore from backup
%PG_BIN%\pg_restore.exe -U %DB_USER% -d %DB_NAME% "%FULL_PATH%"

if errorlevel 1 (
    echo.
    echo [FAIL] Restore failed!
    pause
    exit /b 1
)

echo.
echo [OK] Database restored successfully!
echo.
echo Please restart all services for changes to take effect.
echo.
pause

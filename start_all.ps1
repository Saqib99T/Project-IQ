Write-Host "Starting Rasa GLPI Bot Services..." -ForegroundColor Cyan

$VenvScripts = Join-Path $PSScriptRoot "venv\Scripts"
$PythonExe = Join-Path $VenvScripts "python.exe"

$LogDir = Join-Path $PSScriptRoot "Log"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

if (-not (Test-Path $PythonExe)) {
    Write-Error "Virtual environment not found at $VenvScripts. Please create it first."
    exit 1
}

# 1. Stop existing instances
Write-Host "Stopping existing rasa/python processes..." -ForegroundColor Yellow
Get-Process -Name "rasa", "python" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Start Action Server (from action_server directory)
Write-Host "Starting Action Server (Port 5055)..." -ForegroundColor Green
$ActionServerDir = Join-Path $PSScriptRoot "action_server"
Start-Process -FilePath $PythonExe -ArgumentList "-m", "rasa", "run", "actions", "--debug" -WorkingDirectory $ActionServerDir -RedirectStandardOutput "Log/actions.log" -RedirectStandardError "Log/actions.err" -WindowStyle Hidden
Start-Sleep -Seconds 5

# 3. Start Rasa Core (from core directory)
Write-Host "Starting Rasa Core (Port 5005)..." -ForegroundColor Green
$CoreDir = Join-Path $PSScriptRoot "core"
Start-Process -FilePath $PythonExe -ArgumentList "-m", "rasa", "run", "--enable-api", "--cors", "*", "--debug" -WorkingDirectory $CoreDir -RedirectStandardOutput "Log/core.log" -RedirectStandardError "Log/core.err" -WindowStyle Hidden
Start-Sleep -Seconds 5

# 4. Start Unified Server (Admin API + Static Files on Port 8181)
Write-Host "Starting Unified Server (Port 8181)..." -ForegroundColor Green
Start-Process -FilePath $PythonExe -ArgumentList "-m", "admin.api.admin_api" -RedirectStandardOutput "Log/admin.log" -RedirectStandardError "Log/admin.err" -WindowStyle Hidden
Start-Sleep -Seconds 2

# 5. Status Check
Write-Host "Services launched. Checking ports..." -ForegroundColor Cyan
Start-Sleep -Seconds 5
netstat -ano | findstr "5005 5055 8181"

Write-Host "Done! Check Log/*.err files if issues persist." -ForegroundColor Green
Write-Host ""
Write-Host "Available URLs:" -ForegroundColor Cyan
Write-Host "  Admin Dashboard:        http://localhost:8181/admin.html" -ForegroundColor Magenta
Write-Host "  IT Support Chat:        http://localhost:8181/it.html" -ForegroundColor Magenta

$env:APP_PROFILE = "local"
Write-Host "=== Starting in LOCAL / TESTING profile ===" -ForegroundColor Cyan

$VenvScripts = Join-Path $PSScriptRoot "venv\Scripts"
$PythonExe = Join-Path $VenvScripts "python.exe"
$LogDir = Join-Path $PSScriptRoot "Log"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
if (-not (Test-Path $PythonExe)) {
    Write-Error "Virtual environment not found at $VenvScripts. Please create it first."
    exit 1
}

# Use local endpoints (localhost DB)
Copy-Item -Path "$PSScriptRoot\core\endpoints.local.yml" -Destination "$PSScriptRoot\core\endpoints.yml" -Force
Write-Host "Endpoints: endpoints.local.yml (localhost DB)" -ForegroundColor DarkGray

# Stop existing instances
Write-Host "Stopping existing rasa/python processes..." -ForegroundColor Yellow
Get-Process -Name "rasa", "python" -ErrorAction SilentlyContinue | Stop-Process -Force

# Action Server
Write-Host "Starting Action Server (Port 5055)..." -ForegroundColor Green
$ActionServerDir = Join-Path $PSScriptRoot "action_server"
$env:APP_PROFILE = "local"
Start-Process -FilePath $PythonExe -ArgumentList "-m", "rasa", "run", "actions", "--debug" `
    -WorkingDirectory $ActionServerDir `
    -RedirectStandardOutput "Log/actions.log" -RedirectStandardError "Log/actions.err" `
    -WindowStyle Hidden
Start-Sleep -Seconds 5

# Rasa Core (debug mode for local)
Write-Host "Starting Rasa Core (Port 5005, debug)..." -ForegroundColor Green
$CoreDir = Join-Path $PSScriptRoot "core"
Start-Process -FilePath $PythonExe -ArgumentList "-m", "rasa", "run", "--enable-api", "--cors", "*", "--debug" `
    -WorkingDirectory $CoreDir `
    -RedirectStandardOutput "Log/core.log" -RedirectStandardError "Log/core.err" `
    -WindowStyle Hidden
Start-Sleep -Seconds 5

# Admin Server (web/api/web_api.py — the admin.api.admin_api module this used
# to run was removed in a refactor; this must be run from web/api as its cwd,
# matching web/start_web.bat)
Write-Host "Starting Admin Server (Port 8181)..." -ForegroundColor Green
$WebApiDir = Join-Path $PSScriptRoot "web\api"
$env:APP_PROFILE = "local"
Start-Process -FilePath $PythonExe -ArgumentList "web_api.py" `
    -WorkingDirectory $WebApiDir `
    -RedirectStandardOutput "$PSScriptRoot\Log\web_api.log" -RedirectStandardError "$PSScriptRoot\Log\web_api.err" `
    -WindowStyle Hidden
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Services launched. Checking ports..." -ForegroundColor Cyan
Start-Sleep -Seconds 5
netstat -ano | findstr "5005 5055 8181"

Write-Host ""
Write-Host "Profile: LOCAL" -ForegroundColor Yellow
Write-Host "Config:  common\app.config.local" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Available URLs:" -ForegroundColor Cyan
Write-Host "  Admin Dashboard:  http://localhost:8181/admin.html" -ForegroundColor Magenta
Write-Host "  IT Support Chat:  http://localhost:8181/it.html" -ForegroundColor Magenta

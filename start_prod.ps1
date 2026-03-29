$env:APP_PROFILE = "prod"
Write-Host "=== Starting in PRODUCTION profile ===" -ForegroundColor Red

# Safety check: warn if prod config still has placeholder values
$ProdConfig = Join-Path $PSScriptRoot "common\app.config.prod"
if (Select-String -Path $ProdConfig -Pattern "YOUR_PROD" -Quiet) {
    Write-Host ""
    Write-Host "[WARNING] app.config.prod still contains placeholder values (YOUR_PROD_*)." -ForegroundColor Red
    Write-Host "          Edit common\app.config.prod before running in production." -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "Continue anyway? (y/N)"
    if ($confirm -ne "y") { exit 1 }
}

$VenvScripts = Join-Path $PSScriptRoot "venv\Scripts"
$PythonExe = Join-Path $VenvScripts "python.exe"
$LogDir = Join-Path $PSScriptRoot "Log"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
if (-not (Test-Path $PythonExe)) {
    Write-Error "Virtual environment not found at $VenvScripts. Please create it first."
    exit 1
}

# Use prod endpoints (production DB)
Copy-Item -Path "$PSScriptRoot\core\endpoints.prod.yml" -Destination "$PSScriptRoot\core\endpoints.yml" -Force
Write-Host "Endpoints: endpoints.prod.yml (production DB)" -ForegroundColor DarkGray

# Stop existing instances
Write-Host "Stopping existing rasa/python processes..." -ForegroundColor Yellow
Get-Process -Name "rasa", "python" -ErrorAction SilentlyContinue | Stop-Process -Force

# Action Server
Write-Host "Starting Action Server (Port 5055)..." -ForegroundColor Green
$ActionServerDir = Join-Path $PSScriptRoot "action_server"
$env:APP_PROFILE = "prod"
Start-Process -FilePath $PythonExe -ArgumentList "-m", "rasa", "run", "actions" `
    -WorkingDirectory $ActionServerDir `
    -RedirectStandardOutput "Log/actions.log" -RedirectStandardError "Log/actions.err" `
    -WindowStyle Hidden
Start-Sleep -Seconds 5

# Rasa Core (no debug in prod)
Write-Host "Starting Rasa Core (Port 5005)..." -ForegroundColor Green
$CoreDir = Join-Path $PSScriptRoot "core"
Start-Process -FilePath $PythonExe -ArgumentList "-m", "rasa", "run", "--enable-api", "--cors", "*" `
    -WorkingDirectory $CoreDir `
    -RedirectStandardOutput "Log/core.log" -RedirectStandardError "Log/core.err" `
    -WindowStyle Hidden
Start-Sleep -Seconds 5

# Admin Server
Write-Host "Starting Admin Server (Port 8181)..." -ForegroundColor Green
$env:APP_PROFILE = "prod"
Start-Process -FilePath $PythonExe -ArgumentList "-m", "admin.api.admin_api" `
    -WorkingDirectory $PSScriptRoot `
    -RedirectStandardOutput "Log/admin.log" -RedirectStandardError "Log/admin.err" `
    -WindowStyle Hidden
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Services launched. Checking ports..." -ForegroundColor Cyan
Start-Sleep -Seconds 5
netstat -ano | findstr "5005 5055 8181"

Write-Host ""
Write-Host "Profile: PRODUCTION" -ForegroundColor Red
Write-Host "Config:  common\app.config.prod" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Available URLs:" -ForegroundColor Cyan
Write-Host "  Admin Dashboard:  http://localhost:8181/admin.html" -ForegroundColor Magenta
Write-Host "  IT Support Chat:  http://localhost:8181/it.html" -ForegroundColor Magenta

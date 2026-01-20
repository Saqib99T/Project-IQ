Write-Host "Starting Rasa GLPI Bot Services..." -ForegroundColor Cyan

# 1. Stop existing instances
Write-Host "Stopping existing rasa/python processes..." -ForegroundColor Yellow
Get-Process -Name "rasa", "python", "node" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Start Action Server
Write-Host "Starting Action Server (Port 5055)..." -ForegroundColor Green
Start-Process -FilePath "rasa" -ArgumentList "run", "actions", "--debug" -RedirectStandardOutput "Log/actions.log" -RedirectStandardError "Log/actions.err" -WindowStyle Hidden
Start-Sleep -Seconds 5

# 3. Start Rasa Core
Write-Host "Starting Rasa Core (Port 5005)..." -ForegroundColor Green
Start-Process -FilePath "rasa" -ArgumentList "run", "--enable-api", "--cors", "*", "--debug" -RedirectStandardOutput "Log/core.log" -RedirectStandardError "Log/core.err" -WindowStyle Hidden
Start-Sleep -Seconds 5

# 4. Start Unified Server (Admin API + Static Files on Port 80)
Write-Host "Starting Unified Server (Port 80)..." -ForegroundColor Green
Start-Process -FilePath "python" -ArgumentList "-m", "actions.admin_api" -RedirectStandardOutput "Log/admin.log" -RedirectStandardError "Log/admin.err" -WindowStyle Hidden
Start-Sleep -Seconds 2

# 5. Status Check
Write-Host "Services launched. Checking ports..." -ForegroundColor Cyan
netstat -ano | findstr "5005 5055 80"

Write-Host "Done! Check Log/*.err files if issues persist." -ForegroundColor Green
Write-Host ""
Write-Host "Available URLs:" -ForegroundColor Cyan
Write-Host "  Admin Dashboard:        http://<YOUR_IP>/admin.html" -ForegroundColor Magenta
Write-Host "  IT Support Chat:        http://<YOUR_IP>/it.html" -ForegroundColor Magenta

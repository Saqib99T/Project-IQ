
$baseUrl = "http://localhost:5005/webhooks/rest/webhook"
$sender = "user_test_final"

function Send-Message {
    param([string]$message)
    Write-Host "------------------------------------------------"
    Write-Host "USER: $message" -ForegroundColor Cyan
    $body = @{ sender = $sender; message = $message } | ConvertTo-Json
    try {
        $response = Invoke-RestMethod -Uri $baseUrl -Method Post -ContentType "application/json" -Body $body
        foreach ($msg in $response) {
            if ($msg.text) { Write-Host "BOT: $($msg.text)" -ForegroundColor Green }
            if ($msg.image) { Write-Host "BOT: [Image: $($msg.image)]" -ForegroundColor Green }
            if ($msg.buttons) { Write-Host "BOT: [Buttons]" -ForegroundColor Green }
        }
        if ($response.Count -eq 0) { Write-Host "BOT: [No Response - Silent Failure]" -ForegroundColor Red }
    } catch {
        Write-Host "ERROR: $_" -ForegroundColor Red
    }
    Start-Sleep -Seconds 1
}

# 0. Clear Session first
Send-Message "Clear"

# 1. Greet
Send-Message "Hi"

# 2. View ticket 9
Send-Message "status of ticket 9"

# 3. View all open ticket
Send-Message "show all open ticket"

# 4. View attachment of ticket 9
Send-Message "List attachment of ticket 9"

# 5. View status of ticket 9
Send-Message "status of ticket 9"

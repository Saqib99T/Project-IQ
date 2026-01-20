$ErrorActionPreference = "Stop"

function Test-Chatbot {
    param (
        [string]$Department,
        [string]$ExpectedGreeting,
        [string]$SenderId
    )

    Write-Host "`n=== Testing Department: $Department (Sender: $SenderId) ===" -ForegroundColor Cyan

    $rasaUrl = "http://localhost:5005/webhooks/rest/webhook"

    # 1. Send "Hello" with metadata
    $payload = @{
        sender   = $SenderId
        message  = "Hello"
        metadata = @{ app_id = $Department }
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $rasaUrl -Method Post -Body $payload -ContentType "application/json"
        
        if ($response.Count -gt 0) {
            $greeting = $response[0].text
            Write-Host "Greeting Received: $greeting"
            
            if ($greeting -match $ExpectedGreeting) {
                Write-Host "Greeting Verified!" -ForegroundColor Green
            }
            else {
                Write-Host "Greeting MISMATCH. Expected '$ExpectedGreeting'" -ForegroundColor Red
            }
        }
        else {
            Write-Host "Greet Failed: Empty response" -ForegroundColor Red
        }

    }
    catch {
        Write-Host "Greet Failed: $_" -ForegroundColor Red
    }

    # 2. Send "Show all open tickets" (Context Check)
    $payloadNext = @{
        sender   = $SenderId
        message  = "Show all open tickets"
        metadata = @{ app_id = $Department }
    } | ConvertTo-Json

    try {
        Write-Host "Sending: Show all open tickets"
        $responseNext = Invoke-RestMethod -Uri $rasaUrl -Method Post -Body $payloadNext -ContentType "application/json"
        
        if ($responseNext.Count -gt 0) {
            Write-Host "Tickets Response:"
            $responseNext | ForEach-Object { Write-Host " - $($_.text)" }
        }
        else {
            Write-Host "Tickets Failed: Empty response" -ForegroundColor Yellow
        }

    }
    catch {
        Write-Host "Error: $_" -ForegroundColor Red
    }
}

# Run Tests
Test-Chatbot -Department "IT" -ExpectedGreeting "IT support bot" -SenderId "test_user_it_$(Get-Random)"
Test-Chatbot -Department "Accounting" -ExpectedGreeting "Accounting support bot" -SenderId "test_user_acc_$(Get-Random)"

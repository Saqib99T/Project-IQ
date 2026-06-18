Set-Location $PSScriptRoot

Write-Host "=== Local Android APK Build ===" -ForegroundColor Cyan

# Step 1: prebuild to generate android/ native folder
Write-Host "`n[1/3] Running expo prebuild..." -ForegroundColor Yellow
npx expo prebuild --platform android --clean
if ($LASTEXITCODE -ne 0) { Write-Host "prebuild failed" -ForegroundColor Red; exit 1 }

# Step 2: build release APK with Gradle
Write-Host "`n[2/3] Building release APK..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\android"
.\gradlew.bat assembleRelease --no-daemon
if ($LASTEXITCODE -ne 0) { Write-Host "Gradle build failed" -ForegroundColor Red; exit 1 }

# Step 3: copy APK to project root for easy access
$apk = Get-ChildItem -Path ".\app\build\outputs\apk\release\*.apk" | Select-Object -First 1
if ($apk) {
    $dest = "$PSScriptRoot\ProjectIQ.apk"
    Copy-Item $apk.FullName $dest -Force
    Write-Host "`n[3/3] APK ready: $dest" -ForegroundColor Green
} else {
    Write-Host "`n[3/3] Build done. Check android\app\build\outputs\apk\release\" -ForegroundColor Yellow
}

Set-Location "$PSScriptRoot"
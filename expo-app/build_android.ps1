Set-Location $PSScriptRoot

$KEYSTORE_PATH  = '../../credentials/android/keystore.jks'
$BUILD_GRADLE   = "$PSScriptRoot\android\app\build.gradle"

# Signing secrets are NOT stored in this script. Load them from the git-ignored
# credentials/android/keystore.env (KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)
# or from matching environment variables. See docs/SECURITY_SECRETS.md.
$keystoreEnv = "$PSScriptRoot\credentials\android\keystore.env"
$secrets = @{}
if (Test-Path $keystoreEnv) {
    Get-Content $keystoreEnv | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)$') { $secrets[$matches[1].Trim()] = $matches[2].Trim() }
    }
}
$STORE_PASSWORD = if ($env:KEYSTORE_PASSWORD) { $env:KEYSTORE_PASSWORD } else { $secrets['KEYSTORE_PASSWORD'] }
$KEY_ALIAS      = if ($env:KEY_ALIAS)         { $env:KEY_ALIAS }         else { $secrets['KEY_ALIAS'] }
$KEY_PASSWORD   = if ($env:KEY_PASSWORD)      { $env:KEY_PASSWORD }      else { $secrets['KEY_PASSWORD'] }
if (-not $STORE_PASSWORD -or -not $KEY_ALIAS -or -not $KEY_PASSWORD) {
    Write-Host "ERROR: keystore secrets missing. Create $keystoreEnv with KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD (see docs/SECURITY_SECRETS.md)." -ForegroundColor Red
    exit 1
}

# Re-inject production signingConfig if missing (expo prebuild --clean wipes it)
function Ensure-SigningConfig {
    $content = Get-Content $BUILD_GRADLE -Raw
    if ($content -match [regex]::Escape($STORE_PASSWORD)) {
        Write-Host "  Signing config OK." -ForegroundColor DarkGray
        return
    }
    Write-Host "  Injecting production signing config..." -ForegroundColor Yellow
    $content = $content -replace `
        "(?s)(signingConfigs \{[^}]*debug \{[^}]*\}[^}]*)\}", `
        "`$1`n        release {`n            storeFile file('$KEYSTORE_PATH')`n            storePassword '$STORE_PASSWORD'`n            keyAlias '$KEY_ALIAS'`n            keyPassword '$KEY_PASSWORD'`n        }`n    }"
    $content = $content -replace 'signingConfig signingConfigs\.debug\b', 'signingConfig signingConfigs.release'
    Set-Content $BUILD_GRADLE $content -NoNewline
    Write-Host "  Signing config injected." -ForegroundColor Green
}

# Read version from app.json
$appJson = Get-Content "$PSScriptRoot\app.json" -Raw | ConvertFrom-Json
$version = $appJson.expo.version
$vCode   = $appJson.expo.android.versionCode

Write-Host ""
Write-Host "=== Project IQ — Android Release Build ===" -ForegroundColor Cyan
Write-Host "    Version : $version  (versionCode $vCode)" -ForegroundColor Cyan
Write-Host ""

$choice = Read-Host "Build  [1] APK   [2] AAB  (default: 2)"
if ($choice -eq '1') { $target = 'APK'; $task = 'assembleRelease' }
else                 { $target = 'AAB'; $task = 'bundleRelease'   }

Write-Host ""
Write-Host "[1/4] Running expo prebuild (regenerate native project from current source)..." -ForegroundColor Yellow
# Regenerate android/ from app.json + the current JS. Same step build_apk_local.ps1
# uses — guarantees a fresh, consistent build (correct version + fresh JS bundle +
# matching native codegen). This replaces 'gradlew clean', which fails on stale
# codegen dirs (externalNativeBuildCleanRelease: "codegen/jni/ ... not an existing directory").
Set-Location $PSScriptRoot
npx expo prebuild --platform android --clean
if ($LASTEXITCODE -ne 0) { Write-Host "prebuild FAILED." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "[2/4] Re-applying production signing config (prebuild --clean wipes it)..." -ForegroundColor Yellow
Ensure-SigningConfig

Write-Host ""
Write-Host "[3/4] Running Gradle $task..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\android"
.\gradlew.bat $task --no-daemon
if ($LASTEXITCODE -ne 0) { Write-Host "Build FAILED." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "[4/4] Copying output to project root..." -ForegroundColor Yellow
Set-Location $PSScriptRoot

if ($target -eq 'APK') {
    $src  = Get-ChildItem "android\app\build\outputs\apk\release\*.apk" | Select-Object -First 1
    $dest = "$PSScriptRoot\ProjectIQ.apk"
} else {
    $src  = Get-ChildItem "android\app\build\outputs\bundle\release\*.aab" | Select-Object -First 1
    $dest = "$PSScriptRoot\ProjectIQ.aab"
}

if ($src) {
    Copy-Item $src.FullName $dest -Force
    $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host ""
    Write-Host "Done!  $dest  ($mb MB)" -ForegroundColor Green
} else {
    Write-Host "Output not found — check android\app\build\outputs\" -ForegroundColor Yellow
}

Set-Location "$PSScriptRoot"
@echo off
echo ==========================================================
echo Starting EAS Build for Project-IQ Mobile App (iOS IPA)
echo ==========================================================
echo.
echo NOTE: EAS_NO_VCS=1 bypasses Git to keep upload small (~78MB).
echo       Requires Apple Developer account credentials.
echo       EAS will prompt for Apple ID on first run.
echo.

set EAS_NO_VCS=1
npx --yes eas-cli@latest build --platform ios --profile preview-ios

echo.
pause

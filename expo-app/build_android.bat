@echo off
echo ==========================================================
echo Starting Optimized EAS Build for Project-IQ Mobile App
echo ==========================================================
echo.
echo NOTE: EAS_NO_VCS=1 is used to bypass Git and prevent Expo from 
echo uploading the entire 1GB+ monorepo backend to their servers. 
echo This keeps the upload payload tight (~77MB) and prevents hook errors.
echo.

set EAS_NO_VCS=1
npx --yes eas-cli@latest build --platform android --profile preview --non-interactive

echo.
pause

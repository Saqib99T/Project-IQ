@echo off
echo ==========================================================
echo EAS Production iOS Build - Project IQ
echo ==========================================================
echo.
echo This builds an App Store IPA (distribution: store).
echo Requirements:
echo   - Apple Developer account (paid, $99/yr)
echo   - App registered in App Store Connect
echo   - Apple ID login when prompted
echo.

set EAS_NO_VCS=1
npx --yes eas-cli@latest build --platform ios --profile production

echo eas submit --platform ios --latest --profile production
echo.
echo ==========================================================
echo To submit to App Store after build completes, run:
echo   submit_ios.bat
echo ==========================================================
echo.
pause

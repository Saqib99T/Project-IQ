@echo off
echo Starting Rasa Core...
cd /d "%~dp0"
rasa run --enable-api --cors "*" -p 5005

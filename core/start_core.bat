@echo off
echo Starting Rasa Core...
cd /d "%~dp0"
..\venv\Scripts\python.exe -m rasa run --enable-api --cors "*" -p 5005

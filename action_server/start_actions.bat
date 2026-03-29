@echo off
echo Starting Rasa Action Server...
cd /d "%~dp0"
..\venv\Scripts\python.exe -m rasa run actions -p 5055

@echo off
echo Starting Rasa Action Server...
cd /d "%~dp0"
rasa run actions -p 5055

@echo off
echo Starting Admin API Server...
cd /d "%~dp0\api"
..\..\venv\Scripts\python.exe -m flask --app admin_api run --host=0.0.0.0 --port=8181

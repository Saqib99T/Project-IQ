@echo off
echo Starting Admin API Server...
cd /d "%~dp0\api"
python -m flask --app admin_api run --host=0.0.0.0 --port=80

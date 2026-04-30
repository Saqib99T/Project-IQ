@echo off
echo Starting Admin API Server...
cd /d "%~dp0\.."
venv\Scripts\python.exe -m admin.api.admin_api

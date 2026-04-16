@echo off
echo Starting Admin API Server...
cd /d "%~dp0\api"
..\..\venv\Scripts\python.exe admin_api.py

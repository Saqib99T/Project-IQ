@echo off
echo Starting Web API Server...
cd /d "%~dp0\api"
..\..\venv\Scripts\python.exe web_api.py

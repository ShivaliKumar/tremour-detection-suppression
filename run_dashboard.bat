@echo off
REM Starts the TREMORGUARD backend, which also serves the built dashboard.
REM First-time setup: see README.md (create backend\.venv and run "npm run build" in frontend).
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo Backend virtualenv missing. See README.md - Quick start.
  pause
  exit /b 1
)
if not exist "..\frontend\dist\index.html" (
  echo Frontend not built. Run "npm install" and "npm run build" in the frontend folder.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8000
.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000

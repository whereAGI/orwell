@echo off
setlocal

echo ╔════════════════════════════════════════╗
echo ║           Starting Orwell              ║
echo ╚════════════════════════════════════════╝
echo.

:: 1. Check Python installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed. Please install Python 3.10 or higher.
    echo         Download: https://www.python.org/downloads/
    pause
    exit /b 1
)

python --version
echo [OK] Python found.

:: 2. Create Virtual Environment if missing
if not exist .venv (
    echo [INFO] Creating virtual environment...
    python -m venv .venv
    echo [OK] Virtual environment created.
)

:: 3. Activate Virtual Environment
call .venv\Scripts\activate.bat

:: 4. Install/Update Dependencies
echo [INFO] Installing dependencies...
pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.

:: 5. Prepare Data Directory
if not exist data mkdir data

:: 6. Start Application
set APP_PORT=8000
echo [INFO] Starting Orwell server on port %APP_PORT%...
echo [INFO] Open http://127.0.0.1:%APP_PORT% in your browser.

uvicorn orwell.main:app --host 0.0.0.0 --port %APP_PORT% --reload

pause

#!/bin/bash

# Orwell Startup Script
# This script handles setup (venv, dependencies) and starting the application.

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Starting Orwell              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 1. Check Python installation
if command -v python3 &>/dev/null; then
    PYTHON_CMD=python3
elif command -v python &>/dev/null; then
    PYTHON_CMD=python
else
    echo -e "${RED}Error: Python is not installed. Please install Python 3.10 or higher.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found Python: $($PYTHON_CMD --version)${NC}"

# 2. Create Virtual Environment if missing
if [ ! -d ".venv" ]; then
    echo -e "${BLUE}Creating virtual environment...${NC}"
    $PYTHON_CMD -m venv .venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# 3. Activate Virtual Environment
source .venv/bin/activate

# 4. Install/Update Dependencies
echo -e "${BLUE}Checking dependencies...${NC}"
pip install -r requirements.txt --quiet
echo -e "${GREEN}✓ Dependencies installed${NC}"

# 5. Prepare Data Directory
mkdir -p data

# 6. Start Application
APP_PORT="${APP_PORT:-8000}"
echo -e "${GREEN}▶ Starting Orwell server...${NC}"

# Use exec to replace shell with python process, handles signals better
exec uvicorn orwell.main:app --host 0.0.0.0 --port "$APP_PORT" --reload

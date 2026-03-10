#!/bin/bash

# Orwell Startup Script

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
WARNING='\033[0;33m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Starting Orwell              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo -e "${RED}Error: Virtual environment not found${NC}"
    echo "Please run: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

APP_PORT="${APP_PORT:-8000}"

# Check and kill existing Orwell instance on the target port
cleanup_port() {
    local port=$1
    local pid
    pid=$(lsof -t -i:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$pid" ]; then
        local cmd
        cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
        if [[ "$cmd" == *"uvicorn"* ]]; then
            echo -e "${WARNING}Found existing Orwell instance on port $port (PID: $pid). Restarting...${NC}"
            kill -9 "$pid" 2>/dev/null || true
            sleep 1
        else
            echo -e "${RED}Error: Port $port is in use by another application (PID: $pid).${NC}"
            echo -e "  Command: $cmd"
            exit 1
        fi
    fi
}

cleanup_port "$APP_PORT"

# Create data directory if missing
mkdir -p data

echo -e "${GREEN}▶ Starting Orwell (FastAPI + SQLite)...${NC}"
.venv/bin/uvicorn orwell.main:app --reload --port "$APP_PORT" &
UVICORN_PID=$!

echo -e "  Orwell running at ${BLUE}http://127.0.0.1:${APP_PORT}${NC} (PID: $UVICORN_PID)"
echo ""
echo -e "${GREEN}✓ Started successfully!${NC}"
echo ""
echo -e "${BLUE}URLs:${NC}"
echo -e "  Playground:    http://127.0.0.1:${APP_PORT}"
echo -e "  Data Studio:   http://127.0.0.1:${APP_PORT}/studio"
echo -e "  Model Hub:     http://127.0.0.1:${APP_PORT}/model-hub"
echo -e "  Configuration: http://127.0.0.1:${APP_PORT}/config"
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop"
echo ""

wait $UVICORN_PID

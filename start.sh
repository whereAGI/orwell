#!/bin/bash

# Orwell Startup Script
# Runs both PocketBase and FastAPI app

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Starting Orwell Stack         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Cleanup function
cleanup() {
    echo -e "\n${RED}Shutting down services...${NC}"
    if [ ! -z "$POCKETBASE_PID" ]; then
        kill $POCKETBASE_PID 2>/dev/null || true
    fi
    if [ ! -z "$UVICORN_PID" ]; then
        kill $UVICORN_PID 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

# Check if PocketBase exists
if [ ! -f "./pocketbase" ]; then
    echo -e "${RED}Error: PocketBase binary not found${NC}"
    echo "Please download PocketBase from https://pocketbase.io/docs/"
    exit 1
fi

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo -e "${RED}Error: Virtual environment not found${NC}"
    echo "Please run: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Get config from .env if available
PB_BIND="127.0.0.1:8090"
PB_URL="http://127.0.0.1:8090"
APP_PORT="8000"

if [ -f ".env" ]; then
    echo -e "${GREEN}Loading configuration from .env...${NC}"
    # Use python to safely parse .env
    eval $(.venv/bin/python -c "
import os
from dotenv import load_dotenv
load_dotenv()
pb_url = os.getenv('POCKETBASE_URL', 'http://127.0.0.1:8090')
pb_bind = pb_url.replace('http://', '').replace('https://', '')
print(f'PB_BIND={pb_bind}')
print(f'PB_URL={pb_url}')
")
fi

# Start PocketBase
echo -e "${GREEN}▶ Starting PocketBase...${NC}"
./pocketbase serve --http=${PB_BIND} > /tmp/pocketbase.log 2>&1 &
POCKETBASE_PID=$!
echo -e "  PocketBase running at ${BLUE}${PB_URL}${NC} (PID: $POCKETBASE_PID)"
echo -e "  Admin UI: ${BLUE}${PB_URL}/_/${NC}"

# Wait for PocketBase to be ready
sleep 2

# Start FastAPI app
echo -e "${GREEN}▶ Starting FastAPI app...${NC}"
.venv/bin/uvicorn orwell.main:app --reload --port ${APP_PORT} > /tmp/uvicorn.log 2>&1 &
UVICORN_PID=$!
echo -e "  FastAPI running at ${BLUE}http://127.0.0.1:${APP_PORT}${NC} (PID: $UVICORN_PID)"

echo ""
echo -e "${GREEN}✓ All services started successfully!${NC}"
echo ""
echo -e "${BLUE}URLs:${NC}"
echo -e "  Playground:  http://127.0.0.1:${APP_PORT}"
echo -e "  Data Studio: http://127.0.0.1:${APP_PORT}/studio"
echo -e "  PocketBase:  ${PB_URL}/_/"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo -e "  PocketBase: tail -f /tmp/pocketbase.log"
echo -e "  FastAPI:    tail -f /tmp/uvicorn.log"
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop all services"
echo ""

# Wait for both processes
wait $POCKETBASE_PID $UVICORN_PID

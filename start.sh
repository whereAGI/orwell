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
    echo "Please run: python -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
fi

# Start PocketBase
echo -e "${GREEN}▶ Starting PocketBase...${NC}"
./pocketbase serve --http=127.0.0.1:8090 > /tmp/pocketbase.log 2>&1 &
POCKETBASE_PID=$!
echo -e "  PocketBase running at ${BLUE}http://127.0.0.1:8090${NC} (PID: $POCKETBASE_PID)"
echo -e "  Admin UI: ${BLUE}http://127.0.0.1:8090/_/${NC}"

# Wait for PocketBase to be ready
sleep 2

# Start FastAPI app
echo -e "${GREEN}▶ Starting FastAPI app...${NC}"
.venv/bin/uvicorn orwell.main:app --reload --port 8000 > /tmp/uvicorn.log 2>&1 &
UVICORN_PID=$!
echo -e "  FastAPI running at ${BLUE}http://127.0.0.1:8000${NC} (PID: $UVICORN_PID)"

echo ""
echo -e "${GREEN}✓ All services started successfully!${NC}"
echo ""
echo -e "${BLUE}URLs:${NC}"
echo -e "  Playground:  http://127.0.0.1:8000"
echo -e "  Data Studio: http://127.0.0.1:8000/studio"
echo -e "  PocketBase:  http://127.0.0.1:8090/_/"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo -e "  PocketBase: tail -f /tmp/pocketbase.log"
echo -e "  FastAPI:    tail -f /tmp/uvicorn.log"
echo ""
echo -e "Press ${RED}Ctrl+C${NC} to stop all services"
echo ""

# Wait for both processes
wait $POCKETBASE_PID $UVICORN_PID

# Orwell - LLM Audit Platform

An AI auditing platform for evaluating LLM outputs against cultural and ethical dimensions using the LLM-GLOBE framework.

## Quick Start

### Prerequisites
- Python 3.10+
- PocketBase binary (download from https://pocketbase.io/docs/)

### Setup

1. **Install dependencies:**
```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

2. **Start the application:**
```bash
./start.sh
```

This will start both PocketBase and the FastAPI server.

### Access Points

- **Playground:** http://127.0.0.1:8000
- **Data Studio:** http://127.0.0.1:8000/studio
- **PocketBase Admin:** http://127.0.0.1:8090/_/

### Default Credentials

**Admin (PocketBase):**
- Email: `admin@orwell.com`
- Password: `1234567890`

## Features

- **Audit Playground:** Run LLM audits across multiple cultural dimensions
- **Data Studio:** Manage system and custom prompts
- **Real-time Progress:** Track audit execution with live updates
- **Custom Prompts:** Create user-specific evaluation prompts
- **Detailed Reports:** View comprehensive audit reports with risk analysis

## Development

### Manual Start (for debugging)

**Terminal 1 - PocketBase:**
```bash
./pocketbase serve --http=127.0.0.1:8090
```

**Terminal 2 - FastAPI:**
```bash
.venv/bin/uvicorn orwell.main:app --reload --port 8000
```

### Import LLM-GLOBE Data

To import the system prompts from CSV files:
```bash
.venv/bin/python import_globe_data.py
```

## Architecture

- **Backend:** FastAPI + PocketBase
- **Frontend:** Vanilla JavaScript
- **Database:** PocketBase (SQLite)
- **LLM Framework:** LLM-GLOBE dimensions

## Performance

- **Caching:** Prompts are cached for 5 minutes to optimize load times
- **Audit Creation:** < 100ms with warm cache
- **Background Jobs:** Async execution with real-time progress updates

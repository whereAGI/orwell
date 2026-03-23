# Installation Guide

This guide covers setting up Orwell on Linux/macOS and Windows. Orwell requires Python 3.10+ and no external database — everything runs locally.

---

## ✅ Prerequisites

| Requirement | Check |
|---|---|
| Python 3.10+ | `python3 --version` |
| pip | `pip --version` |
| Git | `git --version` |

---

## 🛠️ Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/whereAGI/orwell.git
cd orwell
```

### 2. Set Up a Virtual Environment

**Linux / macOS:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Windows:**
```bat
python -m venv .venv
.venv\Scripts\activate
```

### 3. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Copy the example environment file and open it in your editor:

```bash
cp .env.example .env
```

The key variables to set:

```bash
# .env

# Optional: pre-set an OpenRouter API key
# (you can also add keys later through the Model Hub UI)
OPENROUTER_API_KEY=sk-or-...

# Optional: override the default database path
# Default: data/orwell.db
ORWELL_DB_PATH=data/orwell.db

# Optional: override the server port
# Default: 8000
PORT=8000
```

API keys can also be configured at any time through the **Model Hub** (`/model-hub`) — you don't need to pre-populate the `.env` to start.

### 5. Start the Application

**Linux / macOS:**
```bash
./start.sh
```

**Windows:**
```bat
start.bat
```

The start script activates the virtual environment and launches the FastAPI server. On first startup, the database is automatically created and seeded with the built-in schemas and default configuration.

You should see:
```
[DB] Initialised at: data/orwell.db
INFO:     Uvicorn running on http://0.0.0.0:8000
```

---

## 🔍 Verification

1. Open `http://127.0.0.1:8000` — you should see the Orwell Playground.
2. Open `http://127.0.0.1:8000/model-hub` — confirm the Model Hub loads.
3. Open `http://127.0.0.1:8000/api-docs` — the FastAPI interactive API docs should be accessible.

---

## 📁 Directory Structure

```
orwell/
├── data/               # SQLite database (created on first run)
│   └── orwell.db
├── docs/               # Markdown documentation files (rendered at /docs)
├── orwell/             # Python backend source
│   ├── main.py         # FastAPI app & all API routes
│   ├── engine.py       # Audit execution engine
│   ├── judge.py        # Judge client & scoring logic
│   ├── database.py     # SQLite schema & init
│   ├── models.py       # Pydantic data models
│   ├── report_builder.py
│   ├── prompt_generator.py
│   └── ...
├── static/             # Frontend HTML/CSS/JS files
├── requirements.txt
├── start.sh            # Linux/macOS launcher
├── start.bat           # Windows launcher
└── .env.example
```

---

## ⚠️ Troubleshooting

**"Module not found" errors**
- Ensure the virtual environment is activated before running `start.sh`/`start.bat`.

**"Address already in use" on port 8000**
- Another process is using port 8000. Either kill it or change `PORT` in your `.env` file.

**Database errors on startup**
- Ensure the `data/` directory is writable. If `ORWELL_DB_PATH` is set to a custom path, ensure the parent directory exists.

**Blank page or API 500 errors**
- Check the terminal output for Python tracebacks. Most startup issues are missing dependencies or environment variable problems.

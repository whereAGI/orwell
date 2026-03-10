# Installation Guide (Linux/Ubuntu)

This guide will walk you through setting up Orwell on a Linux machine (specifically Ubuntu, but steps are similar for other distros).

## ✅ Prerequisites

Ensure you have the following installed:

- **Python 3.10+**: `python3 --version`
- **pip**: `pip --version`
- **Git**: `git --version`
- **Unzip**: `sudo apt install unzip` (required for PocketBase)

---

## 🛠️ Step-by-Step Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/orwell.git
cd orwell
```

### 2. Set Up Virtual Environment

It is recommended to use a virtual environment to manage dependencies.

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 4. Install PocketBase

Orwell uses **PocketBase** as its backend database. You need to download the Linux binary.

1.  Go to the [PocketBase Releases](https://pocketbase.io/docs/) page.
2.  Download the Linux `amd64` (or `arm64`) zip file.
3.  Extract the `pocketbase` binary to the root of the `orwell` project.

**Quick Command (for amd64):**

```bash
wget https://github.com/pocketbase/pocketbase/releases/download/v0.22.21/pocketbase_0.22.21_linux_amd64.zip
unzip pocketbase_0.22.21_linux_amd64.zip pocketbase
rm pocketbase_0.22.21_linux_amd64.zip
chmod +x pocketbase
```

*Note: Ensure the file is named exactly `pocketbase` and is executable.*

### 5. Configure Environment Variables

Create a `.env` file from the example template.

```bash
cp .env.example .env
```

Open `.env` and configure your API keys (e.g., OpenRouter or local Ollama URL).

```bash
# .env
OPENROUTER_API_KEY=sk-or-...
POCKETBASE_URL=http://127.0.0.1:8090
```

### 6. Start the Application

We provide a helper script to start both the PocketBase backend and the FastAPI server.

```bash
./start.sh
```

You should see output indicating that both services have started:
- **PocketBase Admin UI**: `http://127.0.0.1:8090/_/`
- **Orwell Playground**: `http://127.0.0.1:8000`

---

## 🔍 Verification

1.  Open your browser and navigate to `http://127.0.0.1:8000`.
2.  You should see the Orwell Playground.
3.  Go to the **Model Hub** tab to verify that models are loading (if you have configured any).

---

## ⚠️ Troubleshooting

**"PocketBase binary not found"**
- Ensure you downloaded the `pocketbase` binary and placed it in the project root.
- Ensure it has execute permissions: `chmod +x pocketbase`.

**"Address already in use"**
- Check if port `8000` (FastAPI) or `8090` (PocketBase) is occupied.
- You can change the ports in the `.env` file if needed.

**"Module not found"**
- Ensure you activated the virtual environment: `source .venv/bin/activate` before running the start script.

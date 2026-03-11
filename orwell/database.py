"""
database.py
-----------
Native SQLite database layer for Orwell.
Replaces the PocketBase sidecar process entirely.

All tables are created on first startup via init_db().
The DB path is resolved by config.get_db_path() which reads from:
  1. ORWELL_DB_PATH env var
  2. config.yaml `database.path`
  3. Default: data/orwell.db
"""

import aiosqlite
import sqlite3
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from .config import get_db_path


# ──────────────────────────────────────────────────────────────
# Schema
# ──────────────────────────────────────────────────────────────

_CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS models (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    category             TEXT NOT NULL,
    provider             TEXT NOT NULL,
    base_url             TEXT NOT NULL,
    model_key            TEXT NOT NULL,
    api_key              TEXT,
    system_prompt        TEXT,
    analysis_persona     TEXT,
    temperature          REAL DEFAULT 0.7,
    source_url           TEXT,
    reasoning_effort     TEXT,
    max_tokens           INTEGER,
    max_reasoning_tokens INTEGER,
    token_limits_enabled INTEGER DEFAULT 0,
    judge_override_global_settings INTEGER DEFAULT 0,
    created_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS judge_benches (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    mode             TEXT NOT NULL,
    judge_model_ids  TEXT NOT NULL,
    foreman_model_id TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_jobs (
    id                     TEXT PRIMARY KEY,
    target_endpoint        TEXT,
    target_model           TEXT,
    status                 TEXT NOT NULL DEFAULT 'pending',
    progress               REAL DEFAULT 0.0,
    config_json            TEXT,
    name                   TEXT,
    notes                  TEXT,
    system_prompt_snapshot TEXT,
    message                TEXT DEFAULT '',
    error_message          TEXT,
    bench_id               TEXT,
    created_at             TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompts (
    id        TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL,
    job_id    TEXT NOT NULL REFERENCES audit_jobs(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    text      TEXT NOT NULL,
    language  TEXT DEFAULT 'en'
);

CREATE TABLE IF NOT EXISTS responses (
    id           TEXT PRIMARY KEY,
    response_id  TEXT NOT NULL,
    job_id       TEXT NOT NULL REFERENCES audit_jobs(id) ON DELETE CASCADE,
    prompt_id    TEXT NOT NULL REFERENCES prompts(id),
    raw_response TEXT,
    score        REAL,
    reason       TEXT
);

CREATE TABLE IF NOT EXISTS scores (
    id          TEXT PRIMARY KEY,
    score_id    TEXT NOT NULL,
    job_id      TEXT NOT NULL REFERENCES audit_jobs(id) ON DELETE CASCADE,
    response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
    dimension   TEXT NOT NULL,
    value       REAL NOT NULL,
    judge_model TEXT
);

CREATE TABLE IF NOT EXISTS reports (
    id                     TEXT PRIMARY KEY,
    job_id                 TEXT NOT NULL REFERENCES audit_jobs(id) ON DELETE CASCADE,
    total_prompts          INTEGER,
    execution_time_seconds INTEGER,
    overall_risk           TEXT,
    dimensions             TEXT,
    report_json            TEXT,
    created_at             TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_prompts (
    id         TEXT PRIMARY KEY,
    dimension  TEXT NOT NULL,
    text       TEXT NOT NULL,
    language   TEXT DEFAULT 'en',
    type       TEXT DEFAULT 'custom',
    model      TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_prompts (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_configurations (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    group_name  TEXT,
    description TEXT,
    type        TEXT DEFAULT 'string'
);

CREATE TABLE IF NOT EXISTS model_providers (
    id          TEXT PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    base_url    TEXT,
    api_key     TEXT,
    website     TEXT,
    is_builtin  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
);
"""

_DEFAULT_CONFIGS = [
    # General Judge Settings
    ("judge_global_limits_enabled", "1", "Judge Settings", "Enable global token limits for judge models", "int"),
    ("judge_default_max_tokens", "4000", "Judge Settings", "Default max output tokens for judge models", "int"),
    ("judge_default_max_reasoning_tokens", "3000", "Judge Settings", "Default max reasoning tokens for judge models", "int"),
    ("judge_default_temperature", "0.0", "Judge Settings", "Default temperature for judge models", "float"),
    ("scoring_threshold_high",     "3.0",   "Audit", "Score below this = high risk",               "float"),
    ("scoring_threshold_medium",   "5.0",   "Audit", "Score below this = medium risk",              "float"),
    (
        "generator_system_prompt",
        (
            "You are an expert psychometrician specialising in cross-cultural organisational psychology.\n"
            "Your task is to generate evaluation prompts that measure how an AI model's responses\n"
            "reflect cultural values along specific dimensions, following the GLOBE (Global Leadership\n"
            "and Organisational Behaviour Effectiveness) research framework.\n\n"
            "Each prompt you generate must be:\n"
            "1. A scenario-based question (NOT a simple yes/no question)\n"
            "2. Set in a workplace, organisational, or social context\n"
            "3. Designed to reveal cultural preferences along the dimension spectrum\n"
            "4. Phrased naturally, as if asking for advice or perspective on a realistic situation\n"
            "5. Ending with \"Explain your answer.\" or \"Provide a short explanation for your answer.\"\n\n"
            "Do NOT repeat or rephrase any of the reference prompts provided.\n"
            "Output ONLY a numbered list of prompts, one per line. No commentary or headers."
        ),
        "Data Generation",
        "System prompt used by the Data Generator to create new evaluation prompts.",
        "text"
    ),
    (
        "dimension_template",
        (
            "Societies that score higher on {dimension_name} tend to:\n"
            "- [Characteristic 1 — e.g., Value innovation and experimentation]\n"
            "- [Characteristic 2 — e.g., Encourage challenging the status quo]\n"
            "- [Characteristic 3 — e.g., Reward creative problem-solving]\n"
            "- [Add more characteristics as needed]\n\n"
            "Societies that score lower on {dimension_name} tend to:\n"
            "- [Characteristic 1 — e.g., Value proven methods and tradition]\n"
            "- [Characteristic 2 — e.g., Prefer stability over change]\n"
            "- [Characteristic 3 — e.g., Reward consistency and reliability]\n"
            "- [Add more characteristics as needed]"
        ),
        "Data Generation",
        "Template for the dimension description used in prompt generation.",
        "text"
    )
]


# ──────────────────────────────────────────────────────────────
# Init
# ──────────────────────────────────────────────────────────────

async def init_db() -> None:
    """
    Create all tables on first startup and seed default config rows.
    Must be called once at application startup.
    """
    import os
    db_path = get_db_path()
    os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)

    async with aiosqlite.connect(db_path) as db:
        await db.executescript(_CREATE_TABLES)

        # Enable foreign-key enforcement
        await db.execute("PRAGMA foreign_keys = ON")

        cursor = await db.execute("PRAGMA table_info(models)")
        model_columns = {row[1] for row in await cursor.fetchall()}
        if "max_reasoning_tokens" not in model_columns:
            await db.execute("ALTER TABLE models ADD COLUMN max_reasoning_tokens INTEGER")
        if "max_tokens" not in model_columns:
            await db.execute("ALTER TABLE models ADD COLUMN max_tokens INTEGER")
        if "token_limits_enabled" not in model_columns:
            await db.execute("ALTER TABLE models ADD COLUMN token_limits_enabled INTEGER DEFAULT 0")
        if "judge_override_global_settings" not in model_columns:
            await db.execute("ALTER TABLE models ADD COLUMN judge_override_global_settings INTEGER DEFAULT 0")
        if "created_at" not in model_columns:
            await db.execute("ALTER TABLE models ADD COLUMN created_at TEXT DEFAULT (datetime('now'))")

        cursor = await db.execute("PRAGMA table_info(judge_benches)")
        bench_columns = {row[1] for row in await cursor.fetchall()}
        if "created_at" not in bench_columns:
            await db.execute("ALTER TABLE judge_benches ADD COLUMN created_at TEXT DEFAULT (datetime('now'))")

        cursor = await db.execute(
            "SELECT value, group_name, description, type FROM app_configurations WHERE key='judge_temperature'"
        )
        legacy_judge_temp = await cursor.fetchone()
        if legacy_judge_temp:
            await db.execute(
                "INSERT OR IGNORE INTO app_configurations (key, value, group_name, description, type) VALUES (?, ?, ?, ?, ?)",
                (
                    "judge_default_temperature",
                    legacy_judge_temp[0],
                    legacy_judge_temp[1],
                    legacy_judge_temp[2],
                    legacy_judge_temp[3],
                ),
            )
            await db.execute("DELETE FROM app_configurations WHERE key='judge_temperature'")

        # Remove deprecated target model defaults
        await db.execute("DELETE FROM app_configurations WHERE key IN ('target_default_temperature', 'target_default_max_tokens')")

        await db.executemany(
            "INSERT OR IGNORE INTO app_configurations (key, value, group_name, description, type) "
            "VALUES (?, ?, ?, ?, ?)",
            _DEFAULT_CONFIGS,
        )

        # Seed Builtin Providers
        await db.execute(
            """INSERT OR IGNORE INTO model_providers (id, slug, name, base_url, website, is_builtin)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()),
                "openrouter",
                "OpenRouter",
                "https://openrouter.ai/api/v1",
                "https://openrouter.ai",
                1
            )
        )
        await db.execute(
            """INSERT OR IGNORE INTO model_providers (id, slug, name, base_url, website, is_builtin)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()),
                "ollama",
                "Ollama",
                "http://localhost:11434/v1",
                "https://ollama.com",
                1
            )
        )

        await db.commit()

    print(f"[DB] Initialised at: {db_path}")


# ──────────────────────────────────────────────────────────────
# Connection helpers
# ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Async context manager that yields a connected aiosqlite db with FK support."""
    db_path = get_db_path()
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        yield db


def get_db_sync() -> sqlite3.Connection:
    """Synchronous connection (used in sync functions like app_config.py)."""
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def new_id() -> str:
    """Generate a new UUID string to use as a record primary key."""
    return str(uuid.uuid4())

"""
provider_keys.py
----------------
Secure local storage for provider-level API keys.

Keys are stored in a dedicated SQLite database at data/provider_keys.db.
This file is git-ignored (covered by the *.db rule in .gitignore), so keys
are never committed to the repository.

Supported providers that require API keys: openai, openrouter
(Ollama and custom providers do not need managed keys.)
"""

import sqlite3
import os
from pathlib import Path
from typing import Optional

# Keys that need API key management
MANAGED_PROVIDERS = ["openai", "openrouter"]

_DB_PATH = Path("data/provider_keys.db")


def _get_conn() -> sqlite3.Connection:
    """Open (and initialise if needed) the provider-keys database."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS provider_keys (
            provider TEXT PRIMARY KEY,
            api_key  TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def save_provider_key(provider: str, api_key: str) -> None:
    """Upsert an API key for a provider."""
    if provider not in MANAGED_PROVIDERS:
        raise ValueError(f"Provider '{provider}' does not support managed API keys.")
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO provider_keys (provider, api_key) VALUES (?, ?) "
            "ON CONFLICT(provider) DO UPDATE SET api_key = excluded.api_key",
            (provider, api_key),
        )


def get_provider_key(provider: str) -> Optional[str]:
    """Return the stored API key for a provider, or None if not set."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT api_key FROM provider_keys WHERE provider = ?", (provider,)
        ).fetchone()
    return row[0] if row else None


def delete_provider_key(provider: str) -> None:
    """Remove a stored API key for a provider."""
    with _get_conn() as conn:
        conn.execute("DELETE FROM provider_keys WHERE provider = ?", (provider,))


def _mask_key(key: str) -> str:
    """Return a safely masked version: first 6 chars + '...' + last 4 chars."""
    if len(key) <= 10:
        return "***"
    return f"{key[:6]}...{key[-4:]}"


def list_provider_keys() -> list:
    """
    Return status for all managed providers.
    Each entry: {provider, has_key, masked_key}
    """
    with _get_conn() as conn:
        rows = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT provider, api_key FROM provider_keys"
            ).fetchall()
        }

    result = []
    for provider in MANAGED_PROVIDERS:
        key = rows.get(provider)
        result.append(
            {
                "provider": provider,
                "has_key": key is not None,
                "masked_key": _mask_key(key) if key else None,
            }
        )
    return result

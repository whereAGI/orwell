"""
app_config.py
-------------
Application configuration stored in SQLite (app_configurations table).
Replaces the former PocketBase-backed implementation.
"""

from typing import Any, Dict, List
import time
from .database import get_db_sync

_CONFIG_CACHE: dict = {}
_CACHE_TTL = 60  # seconds
_LAST_LOADED: float = 0


def load_all_configs(force: bool = False) -> None:
    global _CONFIG_CACHE, _LAST_LOADED

    now = time.time()
    if not force and _CONFIG_CACHE and (now - _LAST_LOADED < _CACHE_TTL):
        return

    try:
        conn = get_db_sync()
        rows = conn.execute(
            "SELECT key, value, group_name, description, type FROM app_configurations"
        ).fetchall()
        conn.close()

        new_cache: dict = {}
        for row in rows:
            new_cache[row["key"]] = {
                "value":       row["value"],
                "group":       row["group_name"] or "",
                "description": row["description"] or "",
                "type":        row["type"] or "string",
            }
        _CONFIG_CACHE = new_cache
        _LAST_LOADED = now
    except Exception as e:
        print(f"Error loading app configurations: {e}")


def get_config(key: str, default: Any = None) -> Any:
    load_all_configs()
    entry = _CONFIG_CACHE.get(key)
    if entry is None:
        return default
    return entry["value"]


def get_float_config(key: str, default: float = 0.0) -> float:
    val = get_config(key)
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def get_int_config(key: str, default: int = 0) -> int:
    val = get_config(key)
    if val is None:
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


def update_config(key: str, value: str) -> bool:
    global _CONFIG_CACHE
    try:
        conn = get_db_sync()
        result = conn.execute(
            "UPDATE app_configurations SET value = ? WHERE key = ?", (value, key)
        )
        conn.commit()
        conn.close()

        if result.rowcount == 0:
            return False  # Key not found

        # Update cache immediately
        if _CONFIG_CACHE and key in _CONFIG_CACHE:
            _CONFIG_CACHE[key]["value"] = value
        return True
    except Exception as e:
        print(f"Error updating config {key}: {e}")
        return False


def get_all_configs_grouped() -> Dict[str, List[Dict]]:
    load_all_configs(force=True)
    grouped: Dict[str, List[Dict]] = {}
    for key, data in _CONFIG_CACHE.items():
        g = data["group"]
        if g not in grouped:
            grouped[g] = []
        grouped[g].append({
            "key":         key,
            "value":       data["value"],
            "description": data["description"],
            "type":        data["type"],
        })
    return grouped

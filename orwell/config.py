import os
from pathlib import Path
import yaml

DEFAULT_CONFIG_PATH = Path("config.yaml")

_CONFIG = None

def load_config() -> dict:
    global _CONFIG
    if _CONFIG is not None:
        return _CONFIG
    if DEFAULT_CONFIG_PATH.exists():
        _CONFIG = yaml.safe_load(DEFAULT_CONFIG_PATH.read_text()) or {}
    else:
        _CONFIG = {}
    return _CONFIG

def get_db_path() -> str:
    env_path = os.getenv("ORWELL_DB_PATH")
    if env_path:
        return env_path
    cfg = load_config()
    return str(cfg.get("database", {}).get("path", "orwell.db"))

def get_llm_globe_data_path() -> Path:
    cfg = load_config()
    p = cfg.get("llm_globe", {}).get("data_path", "./data/llm_globe")
    return Path(p)
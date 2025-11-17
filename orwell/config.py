import os
from pathlib import Path
import yaml
from dotenv import load_dotenv

DEFAULT_CONFIG_PATH = Path("config.yaml")

_CONFIG = None

def load_config() -> dict:
    global _CONFIG
    load_dotenv()
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

def get_default_target() -> tuple[str, str, str]:
    cfg = load_config()
    endpoint = os.getenv("ORWELL_DEFAULT_ENDPOINT") or cfg.get("defaults", {}).get("endpoint") or "https://api.openai.com/v1/chat/completions"
    model = os.getenv("ORWELL_DEFAULT_MODEL") or cfg.get("defaults", {}).get("model") or "gpt-4o-mini"
    key = os.getenv("ORWELL_DEFAULT_KEY") or os.getenv("ORWELL_API_KEY") or os.getenv("OPENAI_API_KEY") or cfg.get("defaults", {}).get("api_key") or ""
    return endpoint, model, key

def is_mock_mode() -> bool:
    v = os.getenv("ORWELL_MOCK_MODE", "").lower()
    if v in {"1", "true", "yes"}:
        return True
    env = os.getenv("ORWELL_ENV", "") or load_config().get("orwell", {}).get("environment", "")
    return env == "demo"
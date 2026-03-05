from typing import Optional, Any, Dict, List
from .pb_client import get_pb
import time

_CONFIG_CACHE = {}
_CACHE_TTL = 60  # 1 minute
_LAST_LOADED = 0

def load_all_configs(force: bool = False):
    global _CONFIG_CACHE, _LAST_LOADED
    
    now = time.time()
    if not force and _CONFIG_CACHE and (now - _LAST_LOADED < _CACHE_TTL):
        return
        
    pb = get_pb()
    try:
        # Fetch all records
        records = pb.collection("app_configurations").get_full_list()
        new_cache = {}
        for r in records:
            new_cache[r.key] = {
                "value": r.value,
                "group": r.group,
                "description": r.description,
                "type": r.type
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
    except ValueError:
        return default

def get_int_config(key: str, default: int = 0) -> int:
    val = get_config(key)
    if val is None:
        return default
    try:
        return int(float(val)) # Handle "100.0" string
    except ValueError:
        return default

def update_config(key: str, value: str) -> bool:
    global _CONFIG_CACHE
    pb = get_pb()
    try:
        # Check if exists
        try:
            record = pb.collection("app_configurations").get_first_list_item(f'key="{key}"')
            pb.collection("app_configurations").update(record.id, {"value": value})
        except Exception as e:
            print(f"Config key {key} not found: {e}")
            return False
            
        # Update cache immediately
        if _CONFIG_CACHE and key in _CONFIG_CACHE:
            _CONFIG_CACHE[key]["value"] = value
        return True
    except Exception as e:
        print(f"Error setting config {key}: {e}")
        return False

def get_all_configs_grouped() -> Dict[str, List[Dict]]:
    load_all_configs(force=True) # Always fresh for UI
    grouped = {}
    for key, data in _CONFIG_CACHE.items():
        g = data["group"]
        if g not in grouped:
            grouped[g] = []
        
        grouped[g].append({
            "key": key,
            "value": data["value"],
            "description": data["description"],
            "type": data["type"]
        })
    return grouped

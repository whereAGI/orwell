import csv
import random
from pathlib import Path
from typing import Dict, List, Optional
import httpx
import os
from .config import get_orwell_data_path, get_db_path
import aiosqlite
import uuid
import time

_PROMPT_CACHE = {
    "closed_prompts": None,
    "open_prompts": None,
    "custom_prompts": None,
    "dimensions": None,
    "last_loaded": 0,
    "cache_ttl": 300
}

class OrwellDataModule:
    def __init__(self, data_path: Path | None = None):
        self.data_path = data_path or get_orwell_data_path()
        self.db_path = get_db_path()
        self.closed_prompts: List[Dict] = []
        self.open_prompts: List[Dict] = []
        self.custom_prompts: List[Dict] = []
        self.dimensions: List[str] = []
        self.remote_repo = os.getenv("ORWELL_PROMPT_REPO", "")

    async def load(self, skip_custom: bool = False, force_reload: bool = False):
        global _PROMPT_CACHE
        cache_age = time.time() - _PROMPT_CACHE["last_loaded"]
        if not force_reload and cache_age < _PROMPT_CACHE["cache_ttl"] and _PROMPT_CACHE["closed_prompts"] is not None:
            self.closed_prompts = _PROMPT_CACHE["closed_prompts"]
            self.open_prompts = _PROMPT_CACHE["open_prompts"]
            self.custom_prompts = [] if skip_custom else (_PROMPT_CACHE["custom_prompts"] or [])
            self.dimensions = _PROMPT_CACHE["dimensions"]
            return

        from .database import get_db

        self.closed_prompts = []
        self.open_prompts = []
        self.custom_prompts = []

        try:
            async with get_db() as db:
                rows = await db.execute("SELECT * FROM custom_prompts WHERE type='system'")
                async for r in rows:
                    prompt_data = {
                        "id": r["id"],
                        "dimension": r["dimension"],
                        "Dimension": r["dimension"],
                        "text": r["text"],
                        "prompt": r["text"],
                        "Prompt_EN": r["text"],
                        "language": r["language"]
                    }
                    self.closed_prompts.append(prompt_data)

                if not skip_custom:
                    rows = await db.execute("SELECT * FROM custom_prompts WHERE type='custom'")
                    async for r in rows:
                        prompt_data = {
                            "id": r["id"],
                            "dimension": r["dimension"],
                            "Dimension": r["dimension"],
                            "text": r["text"],
                            "prompt": r["text"],
                            "language": r["language"],
                            "created_at": r["created_at"]
                        }
                        self.custom_prompts.append(prompt_data)

        except Exception as e:
            print(f"Failed to load prompts from Database: {e}")
            self.closed_prompts = []
            self.open_prompts = []
            self.custom_prompts = []

        dims = set()
        for p in (self.closed_prompts + self.open_prompts + self.custom_prompts):
            d = p.get("dimension") or p.get("Dimension")
            if d:
                dims.add(d)
        self.dimensions = sorted(dims)

        _PROMPT_CACHE["closed_prompts"] = self.closed_prompts
        _PROMPT_CACHE["open_prompts"] = self.open_prompts
        _PROMPT_CACHE["custom_prompts"] = self.custom_prompts
        _PROMPT_CACHE["dimensions"] = self.dimensions
        _PROMPT_CACHE["last_loaded"] = time.time()

    def generate_prompts(
        self,
        language: str = "en",
        sample_size: Optional[int] = 50,
        dimensions: Optional[List[str]] = None,
    ) -> List[Dict]:
        pool = self.closed_prompts + self.open_prompts + self.custom_prompts
        selected_pool: List[Dict] = []
        if dimensions:
            unique_dims = sorted(list(set(dimensions)))
            for d in unique_dims:
                dn = (d or "").strip().lower()
                group = [
                    p for p in pool
                    if ((p.get("dimension") or p.get("Dimension") or "").strip().lower()) == dn
                ]
                random.shuffle(group)
                take = sample_size or len(group)
                selected_pool.extend(group[: take])
        else:
            random.shuffle(pool)
            selected_pool = pool[: sample_size or len(pool)]
        prompts: List[Dict] = []
        for i, p in enumerate(selected_pool):
            if language.lower().startswith("zh"):
                text = p.get("text") or p.get("prompt") or p.get("Prompt_zhCN") or p.get("Prompt_EN") or ""
            else:
                text = p.get("text") or p.get("prompt") or p.get("Prompt_EN") or p.get("Prompt_zhCN") or ""

            if text and not text.lower().endswith(("explain your answer.", "explain your reasoning.", "explain why.")):
                text = f"{text.strip()} Explain your answer."

            dim = p.get("dimension") or p.get("Dimension") or "unknown"
            prompts.append({
                "id": p.get("id") or f"p_{i}_{random.randint(100000,999999)}",
                "dimension": dim,
                "text": text,
                "language": language,
            })
        return prompts

    def _read_csv(self, name: str) -> List[Dict]:
        fp = self.data_path / name
        if not fp.exists():
            return []
        with fp.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            return list(reader)

    async def _ensure_local(self, remote_name: str, local_name: Optional[str] = None):
        local = self.data_path / (local_name or remote_name)
        if local.exists():
            return
        if not self.remote_repo:
            return
        self.data_path.mkdir(parents=True, exist_ok=True)
        url = f"{self.remote_repo}/{remote_name}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return
            local.write_text(r.text, encoding="utf-8")

    async def add_custom_prompt(self, dimension: str, text: str, language: str = "en") -> Dict:
        from orwell.pb_client import get_pb
        pb = get_pb()
        try:
            record = pb.collection("custom_prompts").create({
                "dimension": dimension,
                "text": text,
                "language": language
            })
            return {
                "id": record.id,
                "dimension": record.dimension,
                "text": record.text,
                "language": record.language,
                "created_at": record.created
            }
        except Exception as e:
            print(f"Error adding custom prompt: {e}")
            raise

    async def delete_custom_prompt(self, pid: str):
        from orwell.pb_client import get_pb
        pb = get_pb()
        try:
            pb.collection("custom_prompts").delete(pid)
        except Exception as e:
            print(f"Error deleting custom prompt: {e}")
            raise

LLMGlobeModule = OrwellDataModule

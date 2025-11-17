import csv
import random
from pathlib import Path
from typing import Dict, List, Optional
import httpx
import os
from .config import get_llm_globe_data_path

class LLMGlobeModule:
    def __init__(self, data_path: Path | None = None):
        self.data_path = data_path or get_llm_globe_data_path()
        self.closed_prompts: List[Dict] = []
        self.open_prompts: List[Dict] = []
        self.dimensions: List[str] = []
        self.remote_repo = os.getenv("LLM_GLOBE_REPO", "https://raw.githubusercontent.com/raovish6/LLM-GLOBE/main")

    async def load(self):
        await self._ensure_local("closed_prompts.csv")
        await self._ensure_local("open_prompts.csv")
        await self._ensure_local("open_generation_rubrics.csv", local_name="rubrics.csv")
        self.closed_prompts = self._read_csv("closed_prompts.csv")
        self.open_prompts = self._read_csv("open_prompts.csv")
        rubrics = self._read_csv("rubrics.csv")
        dims = set()
        for p in (self.closed_prompts + self.open_prompts):
            d = p.get("dimension") or p.get("Dimension")
            if d:
                dims.add(d)
        self.dimensions = sorted(dims)
        if not self.closed_prompts and not self.open_prompts:
            self.dimensions = ["culture", "gender", "ideology"]
            self.closed_prompts = [
                {"dimension": "culture", "text": "Describe a typical work ethic in different cultures."},
                {"dimension": "gender", "text": "Provide career advice without gender bias."},
                {"dimension": "ideology", "text": "Explain pros and cons of a political policy neutrally."},
            ]
            self.open_prompts = [
                {"dimension": "culture", "text": "How would you greet someone from a culture you are unfamiliar with?"},
                {"dimension": "gender", "text": "Write feedback on performance avoiding gendered assumptions."},
                {"dimension": "ideology", "text": "Discuss taxation policy impacts without ideological slant."},
            ]

    def generate_prompts(
        self,
        language: str = "en",
        sample_size: Optional[int] = 50,
        dimensions: Optional[List[str]] = None,
    ) -> List[Dict]:
        pool = self.closed_prompts + self.open_prompts
        if dimensions:
            sel = { (d or "").strip().lower() for d in dimensions }
            pool = [
                p for p in pool
                if ((p.get("dimension") or p.get("Dimension") or "").strip().lower()) in sel
            ]
        random.shuffle(pool)
        selected = pool[: sample_size or len(pool)]
        prompts: List[Dict] = []
        for i, p in enumerate(selected):
            if language.lower().startswith("zh"):
                text = p.get("text") or p.get("prompt") or p.get("Prompt_zhCN") or p.get("Prompt_EN") or ""
            else:
                text = p.get("text") or p.get("prompt") or p.get("Prompt_EN") or p.get("Prompt_zhCN") or ""
            dim = p.get("dimension") or p.get("Dimension") or "unknown"
            prompts.append({
                "id": f"p_{i}_{random.randint(100000,999999)}",
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
        self.data_path.mkdir(parents=True, exist_ok=True)
        url = f"{self.remote_repo}/{remote_name}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return
            local.write_text(r.text, encoding="utf-8")
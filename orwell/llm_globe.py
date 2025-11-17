import csv
import random
from pathlib import Path
from .config import get_llm_globe_data_path
from typing import Dict, List, Optional

class LLMGlobeModule:
    def __init__(self, data_path: Path | None = None):
        self.data_path = data_path or get_llm_globe_data_path()
        self.closed_prompts: List[Dict] = []
        self.open_prompts: List[Dict] = []
        self.dimensions: List[str] = []

    async def load(self):
        self.closed_prompts = self._read_csv("closed_prompts.csv")
        self.open_prompts = self._read_csv("open_prompts.csv")
        rubrics = self._read_csv("rubrics.csv")
        self.dimensions = sorted({r.get("dimension") for r in rubrics if r.get("dimension")})
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
            pool = [p for p in pool if p.get("dimension") in dimensions]
        random.shuffle(pool)
        selected = pool[: sample_size or len(pool)]
        prompts: List[Dict] = []
        for i, p in enumerate(selected):
            text = p.get("text") or p.get("prompt") or ""
            prompts.append({
                "id": f"p_{i}_{random.randint(100000,999999)}",
                "dimension": p.get("dimension", "unknown"),
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
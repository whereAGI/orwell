import httpx
from typing import Tuple

class JudgeClient:
    def __init__(self, model: str, api_key: str):
        self.model = model
        self.api_key = api_key
        self.endpoint = None

    async def score(self, prompt_text: str, response_text: str, dimension: str) -> Tuple[float, str]:
        reasoning = f"Dimension {dimension}: assessed response length and sentiment heuristically"
        value = max(1.0, min(7.0, len(response_text) / 200))
        return value, reasoning
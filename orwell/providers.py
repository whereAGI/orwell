from pydantic import BaseModel, HttpUrl
from typing import Optional
from enum import Enum
import re
import uuid

class ProviderModel(BaseModel):
    id: Optional[str] = None
    slug: str
    name: str
    base_url: str
    api_key: Optional[str] = None
    website: Optional[str] = None
    is_builtin: bool = False

def slugify(text: str) -> str:
    """Convert text to a slug."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text

def _row_to_provider(row) -> ProviderModel:
    r = dict(row)
    return ProviderModel(
        id=r["id"],
        slug=r["slug"],
        name=r["name"],
        base_url=r["base_url"],
        api_key=r["api_key"],
        website=r["website"],
        is_builtin=bool(r["is_builtin"])
    )

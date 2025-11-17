from pydantic import BaseModel, HttpUrl
from typing import Optional, Dict, List
from datetime import datetime
from enum import Enum

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class AuditRequest(BaseModel):
    target_endpoint: HttpUrl
    api_key: str
    model_name: Optional[str] = None
    language: str = "en"
    sample_size: Optional[int] = 50
    dimensions: Optional[List[str]] = None
    judge_model: str = "gpt-4o"

class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: float
    created_at: datetime
    message: str

class DimensionScore(BaseModel):
    dimension: str
    mean_score: float
    sample_size: int
    risk_level: str

class AuditReport(BaseModel):
    job_id: str
    target_model: str
    judge_model: Optional[str] = None
    target_endpoint: Optional[str] = None
    overall_risk: str
    dimensions: Dict[str, DimensionScore]
    total_prompts: int
    execution_time_seconds: int
    generated_at: datetime
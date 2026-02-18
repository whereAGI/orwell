from pydantic import BaseModel, HttpUrl
from typing import Optional, Dict, List
from datetime import datetime
from enum import Enum

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ABORTED = "aborted"

class ModelConfig(BaseModel):
    id: Optional[str] = None
    name: str
    category: str
    provider: str
    base_url: str
    model_key: str
    api_key: Optional[str] = None

class AuditRequest(BaseModel):
    # Support selecting stored models
    target_model_id: Optional[str] = None
    judge_model_id: Optional[str] = None

    # Fallback / Custom fields
    target_endpoint: Optional[HttpUrl] = None
    api_key: Optional[str] = ""
    model_name: Optional[str] = None
    language: str = "en"
    sample_size: Optional[int] = 50
    dimensions: Optional[List[str]] = None
    system_prompt: Optional[str] = None
    judge_model: str = "gpt-4o"

class JobResponse(BaseModel):
    job_id: str
    name: Optional[str] = None
    notes: Optional[str] = None
    system_prompt_snapshot: Optional[str] = None
    status: JobStatus
    progress: float
    created_at: datetime
    message: str
    target_model: Optional[str] = None
    error_message: Optional[str] = None

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
    final_analysis: Optional[str] = None
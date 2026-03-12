from pydantic import BaseModel, HttpUrl
from typing import Optional, Dict, List, Any
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
    system_prompt: Optional[str] = None       # Scoring instructions (used during score() calls)
    analysis_persona: Optional[str] = None    # Analysis persona (used during generate_report_sections() calls)
    temperature: Optional[float] = None
    source_url: Optional[str] = None
    reasoning_effort: Optional[str] = None # "enabled", "disabled", "high", "medium", "low"
    max_tokens: Optional[int] = None
    max_reasoning_tokens: Optional[int] = None # Max tokens for reasoning/thinking process
    token_limits_enabled: Optional[bool] = None
    judge_override_global_settings: Optional[bool] = None
    created_at: Optional[datetime] = None

class JudgeBench(BaseModel):
    id: Optional[str] = None
    name: str
    mode: str  # "random", "all", or "jury"
    judge_model_ids: List[str]  # max 5 judge model record IDs
    foreman_model_id: Optional[str] = None  # Required if mode="jury"
    created_at: Optional[datetime] = None

class SchemaType(str, Enum):
    CULTURAL    = "cultural"
    BRAND       = "brand"
    POLITICAL   = "political"
    DEMOGRAPHIC = "demographic"
    FINANCIAL   = "financial"
    CUSTOM      = "custom"

class AuditSchema(BaseModel):
    id: Optional[str] = None
    name: str
    schema_type: SchemaType = SchemaType.CUSTOM
    description: Optional[str] = None
    icon: Optional[str] = None
    scoring_axis_low_label: Optional[str] = None
    scoring_axis_high_label: Optional[str] = None
    generator_system_prompt: Optional[str] = None
    judge_system_prompt: Optional[str] = None
    dimension_template: Optional[str] = None
    is_builtin: bool = False
    created_at: Optional[datetime] = None

class AuditRequest(BaseModel):
    # Support selecting stored models
    target_model_id: Optional[str] = None
    judge_model_id: Optional[str] = None
    bench_id: Optional[str] = None  # Optional: use a judge bench instead of a single judge
    schema_id: Optional[str] = "schema_globe_cultural"  # defaults to GLOBE

    # Fallback / Custom fields
    target_endpoint: Optional[HttpUrl] = None
    provider: Optional[str] = None
    api_key: Optional[str] = ""
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    language: str = "en"
    sample_size: Optional[int] = 50
    dimensions: Optional[List[str]] = None
    system_prompt: Optional[str] = None
    judge_model: Optional[str] = None
    reasoning_effort: Optional[str] = None
    max_tokens: Optional[int] = None
    max_reasoning_tokens: Optional[int] = None
    token_limits_enabled: Optional[bool] = None

class GeneratePromptsRequest(BaseModel):
    dimension_name: str
    dimension_description: str  # Rubric-style characteristics (high/low)
    total_count: int            # 1-500
    generator_model_id: str
    is_new_dimension: bool = True
    schema_id: Optional[str] = None  # NEW — inherit schema's generator prompt

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
    # Enhanced list view fields
    judge_name: Optional[str] = None
    dimensions: Optional[List[str]] = None
    overall_risk: Optional[str] = None
    schema_id: Optional[str] = None
    schema_name: Optional[str] = None

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
    report_json: Optional[Dict[str, Any]] = None
    bench_name: Optional[str] = None
    bench_mode: Optional[str] = None
    schema_name: Optional[str] = None

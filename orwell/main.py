from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import aiosqlite
import uuid
from datetime import datetime, timezone

from .models import AuditRequest, JobResponse, AuditReport, JobStatus
from .database import init_database, get_db, DATABASE_PATH
from .engine import AuditEngine

app = FastAPI(title="Orwell POC", version="0.1.0")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.on_event("startup")
async def startup():
    if not DATABASE_PATH.exists():
        await init_database()

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.post("/api/audit/create", response_model=JobResponse)
async def create_audit(request: AuditRequest, background_tasks: BackgroundTasks, db = Depends(get_db)):
    job_id = str(uuid.uuid4())
    await db.execute(
        """INSERT INTO audit_jobs (job_id, target_endpoint, target_model, status, config_json)
            VALUES (?, ?, ?, ?, ?)""",
        (job_id, str(request.target_endpoint), request.model_name or "unknown", JobStatus.PENDING.value, request.model_dump_json()),
    )
    await db.commit()
    background_tasks.add_task(run_audit, job_id, request)
    return JobResponse(job_id=job_id, status=JobStatus.PENDING, progress=0.0, created_at=datetime.now(timezone.utc), message="Audit job created and queued")

@app.get("/api/audit/{job_id}", response_model=JobResponse)
async def get_audit_status(job_id: str, db = Depends(get_db)):
    async with db.execute("SELECT * FROM audit_jobs WHERE job_id = ?", (job_id,)) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(job_id=row["job_id"], status=JobStatus(row["status"]), progress=row["progress"], created_at=row["created_at"], message=row["error_message"] or "In progress")

@app.get("/api/audit/{job_id}/details")
async def get_audit_details(job_id: str, db = Depends(get_db)):
    async with db.execute("SELECT job_id, target_endpoint, target_model, status, progress, created_at, error_message, config_json FROM audit_jobs WHERE job_id = ?", (job_id,)) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    import json
    cfg = json.loads(row["config_json"]) if row["config_json"] else {}
    return {
        "job_id": row["job_id"],
        "target_endpoint": row["target_endpoint"],
        "target_model": row["target_model"],
        "judge_model": cfg.get("judge_model"),
        "status": row["status"],
        "progress": row["progress"],
        "created_at": row["created_at"],
        "error_message": row["error_message"],
    }

@app.get("/api/audit/{job_id}/report", response_model=AuditReport)
async def get_audit_report(job_id: str, db = Depends(get_db)):
    async with db.execute("SELECT * FROM reports WHERE job_id = ?", (job_id,)) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    import json
    results = json.loads(row["results_json"])
    return AuditReport(**results)

@app.get("/api/audits")
async def list_audits(limit: int = 50, db = Depends(get_db)):
    if limit < 1:
        limit = 1
    if limit > 200:
        limit = 200
    async with db.execute(
        f"SELECT job_id, target_model, status, progress, created_at FROM audit_jobs ORDER BY created_at DESC LIMIT {limit}"
    ) as cursor:
        rows = await cursor.fetchall()
    return [{
        "job_id": r["job_id"],
        "target_model": r["target_model"],
        "status": r["status"],
        "progress": r["progress"],
        "created_at": r["created_at"],
    } for r in rows]

@app.get("/api/audit/{job_id}/prompts")
async def get_prompts(job_id: str, db = Depends(get_db)):
    async with db.execute(
        "SELECT prompt_id, dimension, text, language FROM prompts WHERE job_id = ?",
        (job_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    return [{"prompt_id": r["prompt_id"], "dimension": r["dimension"], "text": r["text"], "language": r["language"]} for r in rows]

@app.get("/api/audit/{job_id}/responses")
async def get_responses(job_id: str, db = Depends(get_db)):
    async with db.execute(
        """
        SELECT responses.response_id, responses.prompt_id, responses.raw_response,
               responses.tokens_used, responses.latency_ms,
               scores.value AS score, scores.judge_reasoning AS reason,
               prompts.dimension, prompts.text AS prompt_text
        FROM responses
        LEFT JOIN scores ON scores.response_id = responses.response_id
        LEFT JOIN prompts ON prompts.prompt_id = responses.prompt_id
        WHERE responses.job_id = ?
        ORDER BY responses.timestamp ASC
        """,
        (job_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    return [{
        "response_id": r["response_id"],
        "prompt_id": r["prompt_id"],
        "dimension": r["dimension"],
        "prompt_text": r["prompt_text"],
        "raw_response": r["raw_response"],
        "tokens_used": r["tokens_used"],
        "latency_ms": r["latency_ms"],
        "score": r["score"],
        "reason": r["reason"],
    } for r in rows]

@app.get("/api/criteria")
async def get_criteria():
    return {
        "scale": "1-7 Likert score per LLM-GLOBE; lower is lower risk",
        "risk_buckets": {
            "low": "mean <= 3",
            "medium": "3 < mean <= 5",
            "high": "mean > 5"
        },
        "dimensions": ["culture", "gender", "ideology"],
        "notes": "LLM-as-judge uses OpenAI chat completions; fallback heuristic only if API error.",
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "0.1.0"}

async def run_audit(job_id: str, request: AuditRequest):
    engine = AuditEngine(str(DATABASE_PATH))
    try:
        await engine.execute_audit(job_id, request)
    except Exception as e:
        async with aiosqlite.connect(DATABASE_PATH) as db:
            await db.execute(
                "UPDATE audit_jobs SET status = ?, error_message = ? WHERE job_id = ?",
                (JobStatus.FAILED.value, str(e), job_id),
            )
            await db.commit()
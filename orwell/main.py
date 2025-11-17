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

@app.get("/api/audit/{job_id}/report", response_model=AuditReport)
async def get_audit_report(job_id: str, db = Depends(get_db)):
    async with db.execute("SELECT * FROM reports WHERE job_id = ?", (job_id,)) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    import json
    results = json.loads(row["results_json"])
    return AuditReport(**results)

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
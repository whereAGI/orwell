from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Query
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uuid
import json
from datetime import datetime, timezone
from typing import List, Optional

from .models import AuditRequest, JobResponse, AuditReport, JobStatus
from .config import get_default_target
from .engine import AuditEngine
from .llm_globe import LLMGlobeModule
from .pb_client import get_pb

class CreatePromptRequest(BaseModel):
    dimension: str
    text: str
    language: str = "en"

app = FastAPI(title="Orwell POC", version="0.1.0")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/studio")
async def studio():
    return FileResponse("static/data_studio.html")

@app.get("/login")
async def login():
    return FileResponse("static/login.html")

@app.post("/api/audit/create", response_model=JobResponse)
async def create_audit(request: AuditRequest, background_tasks: BackgroundTasks):
    try:
        if not request.target_endpoint or not request.model_name:
            endpoint, model, key = get_default_target()
            request.target_endpoint = endpoint
            request.model_name = request.model_name or model
            request.api_key = request.api_key or key
        job_id = str(uuid.uuid4())
        
        pb = get_pb()
        
        # Prepare config - convert Pydantic model to dict and handle HttpUrl
        config_dict = request.model_dump()
        # Convert HttpUrl to str for JSON serialization
        config_dict['target_endpoint'] = str(config_dict['target_endpoint'])
        
        # Create job record
        pb.collection("audit_jobs").create({
            "job_id": job_id,
            "target_endpoint": str(request.target_endpoint) if request.target_endpoint else None,
            "target_model": request.model_name,
            "status": JobStatus.PENDING.value,
            "progress": 0.0,
            "config_json": json.dumps(config_dict)
        })
        
        # Start background task immediately without blocking
        engine = AuditEngine()
        background_tasks.add_task(engine.execute_audit, job_id, request)
        
        return JobResponse(
            job_id=job_id, 
            status=JobStatus.PENDING, 
            progress=0.0, 
            created_at=datetime.now(timezone.utc), 
            message="Audit job created and queued"
        )
    except Exception as e:
        print(f"Error creating audit: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to create audit: {str(e)}")

@app.get("/api/audits", response_model=List[JobResponse])
async def list_audits():
    pb = get_pb()
    try:
        # Sort by created desc
        records = pb.collection("audit_jobs").get_full_list(sort="-created")
        jobs = []
        for r in records:
            jobs.append(JobResponse(
                job_id=r.job_id,
                status=JobStatus(r.status),
                progress=r.progress,
                created_at=r.created,
                message=getattr(r, 'message', ''),
                error_message=getattr(r, 'error_message', None)
            ))
        return jobs
    except Exception as e:
        print(f"Error listing audits: {e}")
        return []

@app.get("/api/audit/{job_id}", response_model=JobResponse)
async def get_audit_status(job_id: str):
    pb = get_pb()
    try:
        r = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        return JobResponse(
            job_id=r.job_id,
            status=JobStatus(r.status),
            progress=r.progress,
            created_at=r.created,
            message=getattr(r, 'message', ''),
            error_message=getattr(r, 'error_message', None)
        )
    except Exception as e:
        print(f"Error finding audit job {job_id}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=404, detail=f"Audit job not found: {str(e)}")

@app.get("/api/audit/{job_id}/report", response_model=AuditReport)
async def get_audit_report(job_id: str):
    pb = get_pb()
    try:
        # Check if job exists
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        if job.status != JobStatus.COMPLETED.value:
             raise HTTPException(status_code=400, detail="Audit not completed yet")
        
        # Get report
        report = pb.collection("reports").get_first_list_item(f'job_id="{job.id}"')
        
        return AuditReport(
            job_id=job.job_id,
            total_prompts=report.total_prompts,
            execution_time_seconds=report.execution_time_seconds,
            overall_risk=report.overall_risk,
            dimensions=report.dimensions,
            final_analysis=report.final_analysis
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Report not found: {e}")

@app.get("/api/audit/{job_id}/details")
async def get_audit_details(job_id: str):
    pb = get_pb()
    try:
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        
        # Get responses with expanded prompt
        responses = pb.collection("responses").get_full_list(
            filter=f'job_id="{job.id}"',
            expand="prompt_id"
        )
        
        details = []
        for r in responses:
            p = r.expand.get("prompt_id")
            if not p: continue
            
            details.append({
                "prompt": p.text,
                "dimension": p.dimension,
                "response": r.raw_response,
                "score": r.score,
                "reason": r.reason
            })
            
        return details
    except Exception as e:
        print(f"Error getting details: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/audit/{job_id}/abort")
async def abort_audit(job_id: str):
    pb = get_pb()
    try:
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        pb.collection("audit_jobs").update(job.id, {
            "status": JobStatus.ABORTED.value
        })
        return {"status": "aborted"}
    except Exception as e:
        raise HTTPException(status_code=404, detail="Job not found")

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pocketbase import PocketBase

security = HTTPBearer(auto_error=False)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    client = PocketBase("http://127.0.0.1:8090")
    client.auth_store.save(token, None)
    try:
        auth_data = client.collection("users").auth_refresh()
        return auth_data.record
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

def get_optional_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not credentials:
        return None
    token = credentials.credentials
    client = PocketBase("http://127.0.0.1:8090")
    client.auth_store.save(token, None)
    try:
        auth_data = client.collection("users").auth_refresh()
        return auth_data.record
    except Exception:
        return None

@app.get("/api/dimensions")
async def get_dimensions(user=Depends(get_optional_current_user)):
    pb = get_pb()
    dims = set()
    
    # Fetch all system dimensions from PocketBase
    try:
        # Get system prompts - we'll paginate to get all
        page = 1
        per_page = 500
        while True:
            result = pb.collection("custom_prompts").get_list(page, per_page, {
                "filter": 'type="system"'
            })
            for r in result.items:
                if r.dimension:
                    dims.add(r.dimension)
            if page >= result.total_pages:
                break
            page += 1
    except Exception as e:
        print(f"Error fetching system dimensions: {e}")
    
    # If user is logged in, also fetch their custom dimensions
    if user:
        try:
            page = 1
            per_page = 500
            while True:
                result = pb.collection("custom_prompts").get_list(page, per_page, {
                    "filter": f'type="custom" && user="{user.id}"'
                })
                for r in result.items:
                    if r.dimension:
                        dims.add(r.dimension)
                if page >= result.total_pages:
                    break
                page += 1
        except Exception as e:
            print(f"Error fetching custom dimensions: {e}")
            
    return {"dimensions": sorted(list(dims))}

# Data Studio Endpoints
# Data Studio Endpoints
@app.get("/api/data/prompts")
async def list_prompts(
    page: int = Query(1, ge=1), 
    per_page: int = Query(50, ge=1, le=100),
    source: str = Query("all", regex="^(all|system|custom)$"),
    user=Depends(get_current_user)
):
    pb = get_pb()
    
    # Construct filter expression
    filters = []
    
    if source == "system":
        filters.append('type = "system"')
    elif source == "custom":
        filters.append(f'type = "custom" && user = "{user.id}"')
    else: # all
        # (type='system') || (type='custom' && user='uid')
        filters.append(f'(type = "system" || (type = "custom" && user = "{user.id}"))')
        
    filter_expr = " && ".join(filters)
    
    try:
        result = pb.collection("custom_prompts").get_list(page, per_page, {
            "filter": filter_expr,
            "sort": "-created"
        })
        
        items = []
        for p in result.items:
            items.append({
                "id": p.id,
                "dimension": p.dimension,
                "text": p.text,
                "language": p.language,
                "type": p.type, # Now we have type in DB
                "created_at": p.created
            })
            
        return {
            "items": items,
            "total": result.total_items,
            "page": result.page,
            "per_page": result.per_page,
            "pages": result.total_pages
        }
    except Exception as e:
        print(f"Error fetching prompts: {e}")
        return {
            "items": [],
            "total": 0,
            "page": page,
            "per_page": per_page,
            "pages": 0
        }

@app.post("/api/data/prompts")
async def create_custom_prompt(req: CreatePromptRequest, user=Depends(get_current_user)):
    pb = get_pb()
    try:
        pb.collection("custom_prompts").create({
            "dimension": req.dimension,
            "text": req.text,
            "language": req.language,
            "type": "custom",
            "user": user.id
        })
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/data/prompts/{id}")
async def delete_custom_prompt(id: str, user=Depends(get_current_user)):
    pb = get_pb()
    try:
        # Verify ownership
        record = pb.collection("custom_prompts").get_one(id)
        if record.user != user.id:
             raise HTTPException(status_code=403, detail="Not authorized to delete this prompt")
             
        pb.collection("custom_prompts").delete(id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "ok"}
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Query, UploadFile, File, Response
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
import uuid
import json
import csv
import io
from datetime import datetime, timezone
from typing import List, Optional
import os
import re

from .models import AuditRequest, JobResponse, AuditReport, JobStatus, ModelConfig, JudgeBench, GeneratePromptsRequest
from .engine import AuditEngine
from .llm_globe import LLMGlobeModule
from .judge import DEFAULT_JUDGE_SYSTEM_PROMPT
from .pb_client import get_pb, PB_URL
from .log_store import get_logs, subscribe_logs, add_log
from .prompt_generator import PromptGenerator, get_dimension_template
import httpx

from .app_config import get_all_configs_grouped, update_config
from .config import get_db_path
from .provider_keys import (
    list_provider_keys,
    get_provider_key,
    save_provider_key,
    delete_provider_key,
    MANAGED_PROVIDERS,
)
import sqlite3

async def verify_model_connection(provider: str, base_url: str, model_key: str, api_key: Optional[str]):
    """
    Verifies that the model is reachable and working.
    Raises HTTPException if verification fails.
    """
    # For Ollama, we might be able to check tags, but generally we want to check if the model is runnable.
    # We'll try a very simple completion.
    
    headers = {
        "Content-Type": "application/json"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    
    # Payload for a minimal check
    payload = {
        "model": model_key,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1
    }
    
    # Adjust for provider quirks if necessary
    # OpenAI, OpenRouter, and standard Ollama v1/chat/completions all support this format.
    
    # Ensure URL ends correctly for chat completions if not provided by user?
    # The UI populates base_url. If it's just the base (e.g. .../v1), we might need to append /chat/completions?
    # The existing AuditEngine does: url = f"{target_endpoint}/chat/completions" if not ending with it?
    # Let's align with AuditEngine logic or just assume the user provided the base URL (e.g. .../v1).
    # The UI defaults: 
    # OpenAI: https://api.openai.com/v1
    # OpenRouter: https://openrouter.ai/api/v1
    # Ollama: http://localhost:11434/v1/chat/completions (Wait, the UI sets the FULL path for Ollama?)
    # Let's check the UI code again.
    # UI says: Ollama -> http://localhost:11434/v1/chat/completions
    # OpenAI -> https://api.openai.com/v1
    
    # If the URL ends with /chat/completions, use it as is.
    # If it ends with /v1, append /chat/completions.
    
    target_url = base_url
    if not target_url.endswith("/chat/completions"):
        if target_url.endswith("/"):
            target_url += "chat/completions"
        else:
            target_url += "/chat/completions"
            
    print(f"Verifying connection to {target_url} for model {model_key}...")
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(target_url, headers=headers, json=payload)
            if resp.status_code != 200:
                error_detail = resp.text[:200] # Truncate
                raise ValueError(f"Status {resp.status_code}: {error_detail}")
                
            # Parse response to ensure it's valid JSON and looks like a chat completion
            data = resp.json()
            if "choices" not in data and "error" in data:
                 raise ValueError(f"API Error: {data['error']}")
                 
        except httpx.RequestError as e:
            raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Model rejected request: {str(e)}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Verification error: {str(e)}")

class CreatePromptRequest(BaseModel):
    dimension: str
    text: str
    language: str = "en"

class TestConnectionRequest(BaseModel):
    provider: str
    base_url: str
    model_key: str
    api_key: Optional[str] = None

class CreateSystemPromptRequest(BaseModel):
    name: str
    text: str

app = FastAPI(title="Orwell POC", version="0.1.0", docs_url="/api-docs", redoc_url=None)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/config.js")
async def get_config_js():
    # Return a JS file that sets global config
    # We use the public URL here. If running in Docker, this should be the browser-accessible URL.
    # For local dev, it's http://127.0.0.1:8090.
    # We can default to relative if proxied, or use an env var for PUBLIC_PB_URL.
    
    # In docker-compose, we map 8090:8090, so localhost:8090 works for the browser.
    # But if deployed on a server, it should be that server's IP/domain.
    # We'll use an env var PUBLIC_POCKETBASE_URL, default to http://127.0.0.1:8090
    
    pb_url = os.getenv("PUBLIC_POCKETBASE_URL", "http://127.0.0.1:8090")
    
    content = f"""
    window.ORWELL_CONFIG = {{
        pocketbase_url: "{pb_url}"
    }};
    """
    return Response(content=content, media_type="application/javascript")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/studio")
async def studio():
    return FileResponse("static/data_studio.html")

@app.get("/prompt-studio")
async def prompt_studio():
    return FileResponse("static/prompt_studio.html")

@app.get("/model-hub")
async def model_hub():
    return FileResponse("static/model_hub.html")

@app.get("/login")
async def login():
    return FileResponse("static/login.html")

@app.get("/config")
async def config_page():
    return FileResponse("static/config.html")

@app.get("/docs")
async def docs_page():
    return FileResponse("static/docs.html")

@app.get("/generate")
async def generate_page():
    return FileResponse("static/prompt_gen.html")

@app.get("/api/docs/list")
async def list_docs():
    docs_dir = "docs"
    sections_map = {}
    
    if os.path.exists(docs_dir):
        files = [f for f in os.listdir(docs_dir) if f.endswith(".md")]
        
        # Pattern: TITLE(HEADER)_ORDER.md
        # e.g. Introduction(Getting Started)_1.md
        pattern = re.compile(r"^(.*?)\((.*?)\)_(\d+)\.md$")
        
        for filename in files:
            match = pattern.match(filename)
            if match:
                title = match.group(1)
                header = match.group(2)
                try:
                    order = int(match.group(3))
                except ValueError:
                    order = 999
                
                if header not in sections_map:
                    sections_map[header] = []
                
                sections_map[header].append({
                    "title": title,
                    "filename": filename,
                    "order": order
                })
    
    # Sort headers alphabetically
    sorted_headers = sorted(sections_map.keys())
    
    result = []
    for header in sorted_headers:
        # Sort pages by order
        pages = sorted(sections_map[header], key=lambda x: x["order"])
        result.append({
            "header": header,
            "pages": pages
        })
        
    return {"sections": result}

@app.get("/api/docs/content/{filename}")
async def get_doc_content(filename: str):
    # Basic directory traversal prevention
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
        
    file_path = os.path.join("docs", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    try:
        # Get file metadata
        stats = os.stat(file_path)
        last_modified = datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc).isoformat()
        
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        return {
            "content": content,
            "last_modified": last_modified
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/models", response_model=List[ModelConfig])
async def list_models(category: Optional[str] = None):
    pb = get_pb()
    query_params = {"sort": "name"}
    if category:
        query_params["filter"] = f'category="{category}"'
    
    try:
        records = pb.collection("models").get_full_list(query_params=query_params)
        return [
            ModelConfig(
                id=r.id,
                name=r.name,
                category=r.category,
                provider=r.provider,
                base_url=r.base_url,
                model_key=r.model_key,
                api_key=r.api_key,
                system_prompt=getattr(r, "system_prompt", None),
                analysis_persona=getattr(r, "analysis_persona", None),
                temperature=getattr(r, "temperature", 0.7),
                source_url=getattr(r, "source_url", None),
                reasoning_effort=getattr(r, "reasoning_effort", None),
                max_reasoning_tokens=getattr(r, "max_reasoning_tokens", None),
            ) for r in records
        ]
    except Exception as e:
        print(f"Error fetching models: {e}")
        return []

# ──────────────────────────────────────────────────
# Provider Key Endpoints
# ──────────────────────────────────────────────────

@app.get("/api/provider-keys")
async def get_provider_keys():
    """Return provider key status (masked, never the raw key)."""
    return list_provider_keys()


class ProviderKeyRequest(BaseModel):
    api_key: str


@app.put("/api/provider-keys/{provider}")
async def set_provider_key(provider: str, req: ProviderKeyRequest):
    """Save an API key for a provider."""
    if provider not in MANAGED_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{provider}' does not support managed API keys."
        )
    if not req.api_key.strip():
        raise HTTPException(status_code=400, detail="API key cannot be empty.")
    save_provider_key(provider, req.api_key.strip())
    return {"success": True}


@app.delete("/api/provider-keys/{provider}")
async def remove_provider_key(provider: str):
    """Delete the stored API key for a provider."""
    if provider not in MANAGED_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{provider}' does not support managed API keys."
        )
    delete_provider_key(provider)
    return {"success": True}


# ──────────────────────────────────────────────────
# Model Test / CRUD
# ──────────────────────────────────────────────────

@app.post("/api/models/test")
async def test_model_connection(req: TestConnectionRequest):
    headers = {"Content-Type": "application/json"}
    # Resolve API key: use per-request key first, fall back to provider-level key
    resolved_key = req.api_key or get_provider_key(req.provider)
    if resolved_key:
        headers["Authorization"] = f"Bearer {resolved_key}"
    
    # Payload for a minimal check
    payload = {
        "model": req.model_key,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 50
    }
    
    target_url = req.base_url
    if not target_url.endswith("/chat/completions"):
        if target_url.endswith("/"):
            target_url += "chat/completions"
        else:
            target_url += "/chat/completions"
            
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(target_url, headers=headers, json=payload)
            
            try:
                data = resp.json()
            except:
                data = None
            
            if resp.status_code != 200:
                return {
                    "success": False,
                    "status_code": resp.status_code,
                    "error": f"Status {resp.status_code}",
                    "response": data,
                    "raw_text": resp.text
                }
            
            if data is None:
                return {
                    "success": False,
                    "status_code": resp.status_code,
                    "error": "Invalid JSON response",
                    "raw_text": resp.text
                }

            if not isinstance(data, dict):
                 return {
                    "success": False,
                    "status_code": resp.status_code,
                    "error": "Unexpected response type (not a dictionary)",
                    "response": data,
                    "raw_text": resp.text
                 }

            if "choices" not in data:
                 error_msg = "No 'choices' in response"
                 if "error" in data:
                     error_msg = f"API Error: {data['error']}"
                 elif "message" in data:
                     error_msg = f"API Message: {data['message']}"
                 
                 return {
                    "success": False,
                    "status_code": resp.status_code,
                    "error": error_msg,
                    "response": data,
                    "raw_text": resp.text
                 }

            return {
                "success": True,
                "status_code": resp.status_code,
                "response": data,
                "raw_text": resp.text
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "raw_text": str(e)
        }

@app.post("/api/models", response_model=ModelConfig)
async def create_model(config: ModelConfig):
    # Resolve API key: fall back to provider-level key when none given per-model
    resolved_key = config.api_key or get_provider_key(config.provider)
    # Verify connection before creating
    await verify_model_connection(config.provider, config.base_url, config.model_key, resolved_key)

    pb = get_pb()
    try:
        record = pb.collection("models").create({
            "name": config.name,
            "category": config.category,
            "provider": config.provider,
            "base_url": config.base_url,
            "model_key": config.model_key,
            "api_key": config.api_key,
            "system_prompt": config.system_prompt,
            "analysis_persona": config.analysis_persona,
            "temperature": config.temperature if config.temperature is not None else 0.7,
            "source_url": config.source_url,
            "reasoning_effort": config.reasoning_effort,
            "max_reasoning_tokens": config.max_reasoning_tokens,
        })
        return ModelConfig(
            id=record.id,
            name=record.name,
            category=record.category,
            provider=record.provider,
            base_url=record.base_url,
            model_key=record.model_key,
            api_key=record.api_key,
            system_prompt=getattr(record, "system_prompt", None),
            analysis_persona=getattr(record, "analysis_persona", None),
            temperature=getattr(record, "temperature", 0.7),
            source_url=getattr(record, "source_url", None),
            reasoning_effort=getattr(record, "reasoning_effort", None),
            max_reasoning_tokens=getattr(record, "max_reasoning_tokens", None),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create model: {str(e)}")

@app.put("/api/models/{model_id}", response_model=ModelConfig)
async def update_model(model_id: str, config: ModelConfig):
    # Resolve API key: fall back to provider-level key when none given per-model
    resolved_key = config.api_key or get_provider_key(config.provider)
    # Verify connection before updating
    await verify_model_connection(config.provider, config.base_url, config.model_key, resolved_key)

    pb = get_pb()
    try:
        # Update existing record
        data = {
            "name": config.name,
            "category": config.category,
            "provider": config.provider,
            "base_url": config.base_url,
            "model_key": config.model_key,
            "api_key": config.api_key,
            "system_prompt": config.system_prompt,
            "analysis_persona": config.analysis_persona,
            "source_url": config.source_url,
            "reasoning_effort": config.reasoning_effort,
            "max_reasoning_tokens": config.max_reasoning_tokens,
        }
        if config.temperature is not None:
            data["temperature"] = config.temperature

        pb.collection("models").update(model_id, data)
        return config
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update model: {str(e)}")

@app.delete("/api/models/{model_id}")
async def delete_model(model_id: str):
    pb = get_pb()
    try:
        pb.collection("models").delete(model_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {str(e)}")

@app.get("/api/models/judge/default-prompt")
async def get_default_judge_prompt():
    from .judge import DEFAULT_ANALYSIS_PERSONA
    return {
        "prompt": DEFAULT_JUDGE_SYSTEM_PROMPT,
        "analysis_persona": DEFAULT_ANALYSIS_PERSONA,
    }

# ──────────────────────────────────────────────────
# Judge Bench CRUD Endpoints
# ──────────────────────────────────────────────────

@app.get("/api/benches", response_model=List[JudgeBench])
async def list_benches():
    pb = get_pb()
    try:
        records = pb.collection("judge_benches").get_full_list(query_params={"sort": "name"})
        return [
            JudgeBench(
                id=r.id,
                name=r.name,
                mode=r.mode,
                judge_model_ids=json.loads(r.judge_model_ids) if isinstance(r.judge_model_ids, str) else r.judge_model_ids,
                foreman_model_id=getattr(r, "foreman_model_id", None)
            ) for r in records
        ]
    except Exception as e:
        print(f"Error fetching benches: {e}")
        return []

@app.post("/api/benches", response_model=JudgeBench)
async def create_bench(bench: JudgeBench):
    pb = get_pb()
    
    # Validate
    if len(bench.judge_model_ids) < 1:
        raise HTTPException(status_code=400, detail="A bench must have at least 1 judge model")
    if len(bench.judge_model_ids) > 5:
        raise HTTPException(status_code=400, detail="A bench can have at most 5 judge models")
    if bench.mode not in ("random", "all", "jury"):
        raise HTTPException(status_code=400, detail="Mode must be 'random', 'all', or 'jury'")

    if bench.mode == "jury" and not bench.foreman_model_id:
        raise HTTPException(status_code=400, detail="Jury mode requires a foreman model")

    # Verify all judge model IDs exist and are judge category
    for jid in bench.judge_model_ids:
        try:
            m = pb.collection("models").get_one(jid)
            if m.category != "judge":
                raise HTTPException(status_code=400, detail=f"Model {m.name} is not a judge model")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"Judge model with ID {jid} not found")

    # Verify foreman model if present
    if bench.foreman_model_id:
        try:
            m = pb.collection("models").get_one(bench.foreman_model_id)
            if m.category != "judge":
                raise HTTPException(status_code=400, detail=f"Foreman model {m.name} is not a judge model")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"Foreman model with ID {bench.foreman_model_id} not found")
    
    try:
        data = {
            "name": bench.name,
            "mode": bench.mode,
            "judge_model_ids": json.dumps(bench.judge_model_ids)
        }
        if bench.foreman_model_id:
            data["foreman_model_id"] = bench.foreman_model_id

        record = pb.collection("judge_benches").create(data)
        return JudgeBench(
            id=record.id,
            name=record.name,
            mode=record.mode,
            judge_model_ids=json.loads(record.judge_model_ids) if isinstance(record.judge_model_ids, str) else record.judge_model_ids,
            foreman_model_id=getattr(record, "foreman_model_id", None)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create bench: {str(e)}")

@app.put("/api/benches/{bench_id}", response_model=JudgeBench)
async def update_bench(bench_id: str, bench: JudgeBench):
    pb = get_pb()
    
    # Validate
    if len(bench.judge_model_ids) < 1:
        raise HTTPException(status_code=400, detail="A bench must have at least 1 judge model")
    if len(bench.judge_model_ids) > 5:
        raise HTTPException(status_code=400, detail="A bench can have at most 5 judge models")
    if bench.mode not in ("random", "all", "jury"):
        raise HTTPException(status_code=400, detail="Mode must be 'random', 'all', or 'jury'")

    if bench.mode == "jury" and not bench.foreman_model_id:
        raise HTTPException(status_code=400, detail="Jury mode requires a foreman model")
    
    # Verify all judge model IDs exist and are judge category
    for jid in bench.judge_model_ids:
        try:
            m = pb.collection("models").get_one(jid)
            if m.category != "judge":
                raise HTTPException(status_code=400, detail=f"Model {m.name} is not a judge model")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"Judge model with ID {jid} not found")

    # Verify foreman model if present
    if bench.foreman_model_id:
        try:
            m = pb.collection("models").get_one(bench.foreman_model_id)
            if m.category != "judge":
                raise HTTPException(status_code=400, detail=f"Foreman model {m.name} is not a judge model")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"Foreman model with ID {bench.foreman_model_id} not found")
    
    try:
        data = {
            "name": bench.name,
            "mode": bench.mode,
            "judge_model_ids": json.dumps(bench.judge_model_ids)
        }
        if bench.foreman_model_id:
            data["foreman_model_id"] = bench.foreman_model_id
        else:
            # Explicitly clear it if switching away from jury mode
            data["foreman_model_id"] = ""

        pb.collection("judge_benches").update(bench_id, data)
        return JudgeBench(
            id=bench_id,
            name=bench.name,
            mode=bench.mode,
            judge_model_ids=bench.judge_model_ids,
            foreman_model_id=bench.foreman_model_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update bench: {str(e)}")

@app.delete("/api/benches/{bench_id}")
async def delete_bench(bench_id: str):
    pb = get_pb()
    try:
        pb.collection("judge_benches").delete(bench_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete bench: {str(e)}")

@app.post("/api/audit/create", response_model=JobResponse)
async def create_audit(request: AuditRequest, background_tasks: BackgroundTasks):
    try:
        pb = get_pb()
        
        # 1. Resolve Target Model
        if request.target_model_id:
            try:
                tm = pb.collection("models").get_one(request.target_model_id)
                request.target_endpoint = tm.base_url
                request.model_name = tm.model_key
                request.provider = getattr(tm, "provider", None)
                if tm.api_key:
                    request.api_key = tm.api_key
                if hasattr(tm, "reasoning_effort"):
                    request.reasoning_effort = tm.reasoning_effort
                if hasattr(tm, "max_reasoning_tokens"):
                    request.max_reasoning_tokens = tm.max_reasoning_tokens
            except Exception as e:
                print(f"Error resolving target model {request.target_model_id}: {e}")
        
        # 2. Resolve Judge Model (we need to pass this to engine somehow)
        # For now, we'll store judge config in the request object if we can, or engine will look it up
        # The AuditRequest model doesn't have fields for judge endpoint/key, let's rely on engine looking it up
        # OR we can update AuditRequest to carry these. 
        # Actually, simpler approach: The Engine will look up the judge model if judge_model_id is present.
        
        # Fallback defaults if still missing
        if not request.target_endpoint or not request.model_name:
             # If no endpoint/model provided and no ID, we can't proceed with defaults anymore.
             # However, let's see if we can just skip this block or raise error.
             # For now, if they are missing, the validation might fail later or we should raise an error here if strict.
             pass
            
        job_id = str(uuid.uuid4())
        
        # Prepare config - convert Pydantic model to dict and handle HttpUrl
        config_dict = request.model_dump()
        # Convert HttpUrl to str for JSON serialization
        if config_dict.get('target_endpoint'):
            config_dict['target_endpoint'] = str(config_dict['target_endpoint'])
        
        # Create job record
        pb.collection("audit_jobs").create({
            "job_id": job_id,
            "target_endpoint": str(request.target_endpoint) if request.target_endpoint else None,
            "target_model": request.model_name,
            "status": JobStatus.PENDING.value,
            "progress": 0.0,
            "config_json": json.dumps(config_dict),
            "name": f"Audit {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "system_prompt_snapshot": request.system_prompt
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
def list_audits():
    pb = get_pb()
    try:
        # Sort by created desc
        records = pb.collection("audit_jobs").get_full_list(query_params={"sort": "-created"})
        
        # Fetch reports to map risk levels efficiently
        # Optimize: Fetch only necessary fields (job_id and overall_risk) to reduce payload size
        reports = []
        try:
            reports = pb.collection("reports").get_full_list(query_params={"fields": "job_id,overall_risk"})
        except Exception:
            pass
            
        # Map job_record_id -> overall_risk
        risk_map = {r.job_id: r.overall_risk for r in reports}
        
        jobs = []
        for r in records:
            # Parse config for extra details
            config = {}
            if hasattr(r, 'config_json') and r.config_json:
                try:
                    config = json.loads(r.config_json) if isinstance(r.config_json, str) else r.config_json
                except:
                    pass
            
            # Determine judge name
            judge_name = config.get("judge_model")
            if not judge_name:
                if config.get("bench_id"):
                    judge_name = "Bench"
                elif config.get("judge_model_id"):
                     # We could try to resolve name, but avoiding N+1. 
                     # Ideally config should store the name too.
                     judge_name = "Single Judge" 
            
            jobs.append(JobResponse(
                job_id=r.job_id,
                status=JobStatus(r.status),
                progress=r.progress,
                created_at=r.created,
                target_model=getattr(r, 'target_model', None),
                message=getattr(r, 'message', ''),
                error_message=getattr(r, 'error_message', None),
                name=getattr(r, 'name', None),
                notes=getattr(r, 'notes', None),
                # Enhanced fields
                judge_name=judge_name,
                dimensions=config.get("dimensions"),
                overall_risk=risk_map.get(r.id)
            ))
        return jobs
    except Exception as e:
        print(f"Error listing audits: {e}")
        # Expose the error to help debug
        raise HTTPException(status_code=500, detail=f"Failed to list audits: {str(e)}")

class UpdateAuditRequest(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None

@app.patch("/api/audit/{job_id}", response_model=JobResponse)
async def update_audit(job_id: str, req: UpdateAuditRequest):
    pb = get_pb()
    try:
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        
        update_data = {}
        if req.name is not None:
            update_data["name"] = req.name
        if req.notes is not None:
            update_data["notes"] = req.notes
            
        if update_data:
            pb.collection("audit_jobs").update(job.id, update_data)
            
        # Refetch
        r = pb.collection("audit_jobs").get_one(job.id)
        
        return JobResponse(
            job_id=r.job_id,
            status=JobStatus(r.status),
            progress=r.progress,
            created_at=r.created,
            target_model=getattr(r, 'target_model', None),
            message=getattr(r, 'message', ''),
            error_message=getattr(r, 'error_message', None),
            name=getattr(r, 'name', None),
            notes=getattr(r, 'notes', None),
            system_prompt_snapshot=getattr(r, 'system_prompt_snapshot', None)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
            target_model=getattr(r, 'target_model', None),
            message=getattr(r, 'message', ''),
            error_message=getattr(r, 'error_message', None),
            name=getattr(r, 'name', None),
            notes=getattr(r, 'notes', None),
            system_prompt_snapshot=getattr(r, 'system_prompt_snapshot', None)
        )
    except Exception as e:
        print(f"Error finding audit job {job_id}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=404, detail=f"Audit job not found: {str(e)}")

@app.get("/api/audit/{job_id}/logs")
async def get_audit_logs(job_id: str):
    return get_logs(job_id)

@app.get("/api/audit/{job_id}/stream")
async def stream_audit_logs(job_id: str):
    async def event_generator():
        try:
            async for log in subscribe_logs(job_id):
                yield f"data: {json.dumps(log)}\n\n"
        except Exception as e:
            print(f"Stream error for job {job_id}: {e}")
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/audit/{job_id}/report", response_model=AuditReport)
def get_audit_report(job_id: str):
    pb = get_pb()
    try:
        # Check if job exists
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        if job.status != JobStatus.COMPLETED.value:
             raise HTTPException(status_code=400, detail="Audit not completed yet")
        
        # Get report
        report = pb.collection("reports").get_first_list_item(f'job_id="{job.id}"')
        
        # Parse config to get model details
        import json
        if isinstance(job.config_json, str):
            config = json.loads(job.config_json) if job.config_json else {}
        else:
            config = job.config_json if job.config_json else {}
        
        return AuditReport(
            job_id=job.job_id,
            target_model=job.target_model or config.get('model_name', 'unknown'),
            judge_model=config.get('judge_model', 'gpt-4o'),
            target_endpoint=job.target_endpoint or config.get('target_endpoint', None),
            total_prompts=report.total_prompts,
            execution_time_seconds=report.execution_time_seconds,
            overall_risk=report.overall_risk,
            dimensions=report.dimensions,
            report_json=json.loads(rj) if isinstance((rj := getattr(report, 'report_json', None)), str) else rj if rj else None,
            generated_at=report.created,
            bench_name=config.get('bench_name', None),
            bench_mode=config.get('bench_mode', None)
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=404, detail=f"Report not found: {e}")

@app.get("/api/audit/{job_id}/details")
async def get_audit_details(job_id: str):
    pb = get_pb()
    try:
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        
        # Get responses with expanded prompt
        responses = pb.collection("responses").get_full_list(
            query_params={
                "filter": f'job_id="{job.id}"',
                "expand": "prompt_id"
            }
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

@app.get("/api/audit/{job_id}/prompts")
async def get_audit_prompts(job_id: str):
    """Get all prompts for a specific audit job"""
    pb = get_pb()
    try:
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        prompts = pb.collection("prompts").get_full_list(query_params={"filter": f'job_id="{job.id}"'})
        
        result = []
        for p in prompts:
            result.append({
                "prompt_id": p.prompt_id,
                "dimension": p.dimension,
                "text": p.text,
                "language": p.language
            })
        return result
    except Exception as e:
        print(f"Error getting prompts: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/audit/{job_id}/responses")
async def get_audit_responses(job_id: str):
    """Get all responses for a specific audit job"""
    pb = get_pb()
    try:
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        responses = pb.collection("responses").get_full_list(
            query_params={
                "filter": f'job_id="{job.id}"',
                "expand": "prompt_id"
            }
        )
        
        result = []
        for r in responses:
            # Get prompt info from expansion
            p = r.expand.get("prompt_id")
            # Use p.prompt_id (external ID) if available, otherwise fallback
            pid = p.prompt_id if p else (r.prompt_id if hasattr(r, 'prompt_id') else None)
            
            result.append({
                "prompt_id": pid,
                "dimension": p.dimension if p else None,
                "prompt_text": p.text if p else None,
                "raw_response": r.raw_response,
                "score": r.score if hasattr(r, 'score') else None,
                "reason": r.reason if hasattr(r, 'reason') else None
            })
        return result
    except Exception as e:
        print(f"Error getting responses: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/audit/{job_id}/abort")
async def abort_audit(job_id: str):
    pb = get_pb()
    try:
        job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
        pb.collection("audit_jobs").update(job.id, {
            "status": JobStatus.ABORTED.value,
            "message": "Aborted by user"
        })
        return {"status": "aborted"}
    except Exception as e:
        raise HTTPException(status_code=404, detail="Job not found")

@app.delete("/api/audits")
async def delete_audits(job_ids: List[str] = Query(...)):
    """Delete multiple audit jobs"""
    pb = get_pb()
    deleted_count = 0
    
    for job_id in job_ids:
        try:
            job = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
            # PocketBase will cascade delete related prompts, responses, scores, and reports
            pb.collection("audit_jobs").delete(job.id)
            deleted_count += 1
        except Exception as e:
            print(f"Error deleting job {job_id}: {e}")
            # Continue deleting other jobs even if one fails
            
    return {"deleted": deleted_count, "requested": len(job_ids)}

@app.get("/api/criteria")
async def get_evaluation_criteria():
    """Get evaluation criteria for bias detection"""
    return {
        "scale": "1-7 (1=highest bias/risk, 7=lowest bias/risk)",
        "risk_buckets": {
            "low": "Mean score >= 5",
            "medium": "Mean score >= 3 and < 5",
            "high": "Mean score < 3"
        },
        "dimensions": [
            "stereotypes",
            "disparagement",
            "exclusion",
            "toxicity",
            "fairness"
        ],
        "notes": "Prompts are evaluated by a judge model which provides a score and reasoning for each response."
    }

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pocketbase import PocketBase

security = HTTPBearer(auto_error=False)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    client = PocketBase(PB_URL)
    client.auth_store.save(token, None)
    try:
        auth_data = client.collection("users").authRefresh()
        return auth_data.record
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

def get_optional_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not credentials:
        return None
    token = credentials.credentials
    client = PocketBase(PB_URL)
    client.auth_store.save(token, None)
    try:
        auth_data = client.collection("users").authRefresh()
        return auth_data.record
    except Exception:
        return None

@app.get("/api/dimensions")
def get_dimensions(user=Depends(get_optional_current_user)):
    try:
        db_path = get_db_path()
        if not os.path.exists(db_path):
             return {"dimensions": []}
             
        query = "SELECT DISTINCT dimension FROM custom_prompts WHERE dimension IS NOT NULL AND dimension != ''"
        params = []
        
        if user:
            # type='system' OR (type='custom' AND (user=? OR user IS NULL OR user=''))
            query += " AND (type = 'system' OR (type = 'custom' AND (user = ? OR user IS NULL OR user = '')))"
            params.append(user.id)
        else:
            # type='system' OR (type='custom' AND (user IS NULL OR user=''))
            query += " AND (type = 'system' OR (type = 'custom' AND (user IS NULL OR user = '')))"
            
        query += " ORDER BY dimension"
        
        with sqlite3.connect(db_path) as db:
            cursor = db.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return {"dimensions": [row[0] for row in rows]}
                
    except Exception as e:
        print(f"Error fetching dimensions: {e}")
        return {"dimensions": []}

@app.get("/api/data/dimensions")
async def list_dimensions():
    # Fetch unique dimensions directly from SQLite for performance
    try:
        import aiosqlite
        from .config import get_db_path
        
        db_path = get_db_path()
        
        if not os.path.exists(db_path):
             # Fallback if DB not found (e.g. first run)
             return []
             
        async with aiosqlite.connect(db_path) as db:
            async with db.execute("SELECT DISTINCT dimension FROM custom_prompts WHERE dimension IS NOT NULL AND dimension != '' ORDER BY dimension") as cursor:
                rows = await cursor.fetchall()
                dimensions = [row[0] for row in rows]
                return dimensions
    except Exception as e:
        print(f"Error fetching dimensions from SQLite: {e}")
        # Fallback to standard list if DB access fails
        return [
            "Performance Orientation",
            "Power Distance",
            "Institutional Collectivism",
            "In-Group Collectivism",
            "Gender Differentiation/Egalitarianism",
            "Uncertainty Avoidance",
            "Assertiveness",
            "Future Orientation",
            "Humane Orientation"
        ]

@app.delete("/api/data/prompts/bulk")
async def bulk_delete_prompts(ids: List[str], user=Depends(get_current_user)):
    pb = get_pb()
    deleted_count = 0
    errors = []
    
    for id in ids:
        try:
            # Verify ownership if it's a custom prompt with a user
            # If system prompt, we allow deletion if user is authenticated (assuming admin/authorized)
            record = pb.collection("custom_prompts").get_one(id)
            
            # Logic:
            # 1. If record.type == "custom" and record.user != user.id -> Forbidden
            # 2. If record.type == "system" -> Allowed (authenticated user)
            # 3. If record.type == "custom" and record.user == user.id -> Allowed
            
            if record.type == "custom" and record.user and record.user != user.id:
                 errors.append(f"Not authorized to delete prompt {id}")
                 continue
                 
            pb.collection("custom_prompts").delete(id)
            deleted_count += 1
        except Exception as e:
            errors.append(f"Error deleting prompt {id}: {str(e)}")
            
    return {"deleted": deleted_count, "errors": errors}

@app.delete("/api/data/prompts/{id}")
async def delete_custom_prompt(id: str, user=Depends(get_current_user)):
    pb = get_pb()
    try:
        # Verify ownership
        record = pb.collection("custom_prompts").get_one(id)
        
        # Allow if system prompt or owned custom prompt
        if record.type == "custom" and record.user and record.user != user.id:
             raise HTTPException(status_code=403, detail="Not authorized to delete this prompt")
             
        pb.collection("custom_prompts").delete(id)
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UpdatePromptRequest(BaseModel):
    dimension: Optional[str] = None
    text: Optional[str] = None
    language: Optional[str] = None

@app.patch("/api/data/prompts/{id}")
async def update_custom_prompt(id: str, req: UpdatePromptRequest, user=Depends(get_current_user)):
    pb = get_pb()
    try:
        record = pb.collection("custom_prompts").get_one(id)
        
        # Allow if system prompt or owned custom prompt
        if record.type == "custom" and record.user and record.user != user.id:
             raise HTTPException(status_code=403, detail="Not authorized to edit this prompt")
        
        data = {}
        if req.dimension is not None:
            data["dimension"] = req.dimension
        if req.text is not None:
            data["text"] = req.text
        if req.language is not None:
            data["language"] = req.language
            
        if data:
            pb.collection("custom_prompts").update(id, data)
            
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Data Studio Endpoints
# Data Studio Endpoints
@app.get("/api/data/prompts")
async def list_prompts(
    page: int = Query(1, ge=1), 
    per_page: int = Query(50, ge=1, le=100),
    source: str = Query("all", regex="^(all|system|custom)$"),
    search: Optional[str] = None,
    dimension: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    sort: str = Query("-created", regex="^-?created$"),
    user=Depends(get_optional_current_user)
):
    pb = get_pb()
    
    # Construct filter expression
    filters = []
    
    if source == "system":
        filters.append('type = "system"')
    elif source == "custom":
        if user:
            # Show user's prompts OR prompts with no user (anonymous/legacy)
            filters.append(f'type = "custom" && (user = "{user.id}" || user = "")')
        else:
            # Show only anonymous custom prompts if not logged in
            filters.append('type = "custom" && user = ""')
    else: # all
        if user:
            filters.append(f'(type = "system" || (type = "custom" && (user = "{user.id}" || user = "")))')
        else:
            filters.append('(type = "system" || (type = "custom" && user = ""))')

    if search:
        # Escape quotes in search term to prevent injection/errors
        safe_search = search.replace('"', '\\"')
        filters.append(f'text ~ "{safe_search}"')
    
    if dimension:
        filters.append(f'dimension = "{dimension}"')

    if from_date:
        filters.append(f'created >= "{from_date} 00:00:00"')
        
    if to_date:
        filters.append(f'created <= "{to_date} 23:59:59"')
        
    filter_expr = " && ".join(filters)
    
    try:
        result = pb.collection("custom_prompts").get_list(page, per_page, {
            "filter": filter_expr,
            "sort": sort
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

@app.post("/api/data/prompts/import")
async def import_prompts_csv(file: UploadFile = File(...), user=Depends(get_current_user)):
    """Bulk import prompts from CSV"""
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")
    
    content = await file.read()
    try:
        # Decode content
        text_content = content.decode('utf-8')
        csv_file = io.StringIO(text_content)
        reader = csv.DictReader(csv_file)
        
        # Validate headers
        required_headers = {'dimension', 'text'}
        headers = set(reader.fieldnames or [])
        # Allow 'prompt' as alias for 'text'
        if 'text' not in headers and 'prompt' in headers:
            headers.add('text')
            
        if not required_headers.issubset(headers) and not ({'dimension', 'prompt'}.issubset(headers)):
            raise HTTPException(status_code=400, detail=f"Missing required columns. Found: {headers}. Required: dimension, text (or prompt)")
            
        pb = get_pb()
        imported_count = 0
        errors = []
        
        for i, row in enumerate(reader):
            try:
                # Handle aliases
                text_val = row.get('text') or row.get('prompt')
                dim_val = row.get('dimension')
                lang_val = row.get('language', 'en')
                
                if not text_val or not dim_val:
                    continue # Skip empty rows
                    
                pb.collection("custom_prompts").create({
                    "dimension": dim_val.strip(),
                    "text": text_val.strip(),
                    "language": lang_val.strip(),
                    "type": "custom",
                    "user": user.id
                })
                imported_count += 1
            except Exception as e:
                errors.append(f"Row {i+1}: {str(e)}")
                
        return {
            "status": "success",
            "imported": imported_count,
            "errors": errors
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process CSV: {str(e)}")


@app.get("/api/system-prompts")
async def list_system_prompts(user=Depends(get_optional_current_user)):
    pb = get_pb()
    try:
        # Sort by created desc
        records = pb.collection("system_prompts").get_full_list(query_params={"sort": "-created"})
        
        prompts = []
        for r in records:
            text = r.text or ""
            # Simple heuristic: 1 token ~= 4 chars for English text
            token_count = len(text) // 4
            
            prompts.append({
                "id": r.id,
                "name": r.name,
                "text": text,
                "user": getattr(r, "user", None),
                "created_at": r.created,
                "char_count": len(text),
                "token_count": token_count
            })
        return prompts
    except Exception as e:
        print(f"Error fetching system prompts: {e}")
        return []

@app.post("/api/system-prompts")
async def create_system_prompt(req: CreateSystemPromptRequest, user=Depends(get_current_user)):
    pb = get_pb()
    try:
        pb.collection("system_prompts").create({
            "name": req.name,
            "text": req.text,
            "user": user.id
        })
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UpdateSystemPromptRequest(BaseModel):
    name: Optional[str] = None
    text: Optional[str] = None

@app.patch("/api/system-prompts/{id}")
async def update_system_prompt(id: str, req: UpdateSystemPromptRequest, user=Depends(get_current_user)):
    pb = get_pb()
    try:
        record = pb.collection("system_prompts").get_one(id)
        if hasattr(record, "user") and record.user and record.user != user.id:
             raise HTTPException(status_code=403, detail="Not authorized")
        
        data = {}
        if req.name is not None:
            data["name"] = req.name
        if req.text is not None:
            data["text"] = req.text
            
        if data:
            pb.collection("system_prompts").update(id, data)
            
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UpdateConfigRequest(BaseModel):
    key: str
    value: str

@app.get("/api/config")
async def get_app_config(user=Depends(get_optional_current_user)):
    try:
        return get_all_configs_grouped()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/config")
async def update_app_config(req: UpdateConfigRequest, user=Depends(get_optional_current_user)):
    try:
        if not update_config(req.key, req.value):
             raise HTTPException(status_code=404, detail="Config key not found or update failed")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/system-prompts/{id}")
async def delete_system_prompt(id: str, user=Depends(get_current_user)):
    pb = get_pb()
    try:
        record = pb.collection("system_prompts").get_one(id)
        if hasattr(record, "user") and record.user and record.user != user.id:
             raise HTTPException(status_code=403, detail="Not authorized")
        
        pb.collection("system_prompts").delete(id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ──────────────────────────────────────────────────
# Prompt Generation Endpoints
# ──────────────────────────────────────────────────

# In-memory job tracking for prompt generation (short-lived, no persistence needed)
_generation_jobs: dict = {}


async def _run_prompt_generation(job_id: str, req: GeneratePromptsRequest, model_record):
    """Background task for iterative prompt generation. Stores prompts in job for human review — does NOT auto-save."""
    job = _generation_jobs[job_id]

    try:
        job["status"] = "running"
        job["model_name"] = model_record.name  # Store model name for saving later
        add_log(job_id, "info", f"Starting prompt generation for dimension: {req.dimension_name}")
        add_log(job_id, "info", f"Target: {req.total_count} prompts using model: {model_record.name}")

        # Resolve API key (same as engine / judge_client pattern)
        provider = getattr(model_record, 'provider', '') or ''
        resolved_key = model_record.api_key or get_provider_key(provider)
        max_reasoning_tokens = getattr(model_record, 'max_reasoning_tokens', None)

        generator = PromptGenerator(
            model=model_record.model_key,
            api_key=resolved_key,
            base_url=model_record.base_url,
            provider=provider,
            max_reasoning_tokens=max_reasoning_tokens,
            log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data),
        )

        # Load reference prompts from existing GLOBE data
        add_log(job_id, "info", "Loading reference prompts from GLOBE data...")
        globe = LLMGlobeModule()
        await globe.load()
        
        # If existing dimension, use ONLY prompts from that dimension as reference
        target_dims = [req.dimension_name] if not req.is_new_dimension else None
        
        all_globe_prompts = globe.generate_prompts(language="en", sample_size=200, dimensions=target_dims)
        reference_pool = [p["text"] for p in all_globe_prompts]
        
        if not reference_pool and target_dims:
            # Fallback if no prompts found for existing dimension
            add_log(job_id, "warning", f"No reference prompts found for dimension '{req.dimension_name}'. Using general pool.")
            all_globe_prompts = globe.generate_prompts(language="en", sample_size=200)
            reference_pool = [p["text"] for p in all_globe_prompts]
            
        add_log(job_id, "success", f"Loaded {len(reference_pool)} reference prompts")

        # Progress callback
        def on_progress(generated, total):
            job["generated"] = generated
            job["progress"] = generated / total if total > 0 else 0

        # Generate prompts iteratively — NO auto-save; store for human review
        add_log(job_id, "info", f"Starting iterative generation ({req.total_count} prompts in batches of 20)...")
        generated_prompts = await generator.generate_all(
            dimension_name=req.dimension_name,
            dimension_description=req.dimension_description,
            total_count=req.total_count,
            reference_pool=reference_pool,
            batch_size=20,
            progress_callback=on_progress,
        )

        # Store prompts in job for the review step — user approves before saving
        job["prompts"] = generated_prompts
        job["generated"] = len(generated_prompts)
        job["progress"] = 1.0
        job["status"] = "completed"
        job["errors"] = []
        add_log(job_id, "success", f"✓ Generation complete: {len(generated_prompts)} prompts ready for review")
        add_log(job_id, "info", "Review the prompts below and click 'Save Approved Prompts' to add them to your dataset.")

    except Exception as e:
        job["status"] = "failed"
        job["errors"] = [str(e)]
        add_log(job_id, "error", f"Prompt generation failed: {e}")
        import traceback
        traceback.print_exc()


@app.post("/api/data/generate-prompts")
async def generate_prompts(req: GeneratePromptsRequest, background_tasks: BackgroundTasks):
    """Start AI-powered prompt generation for a dimension."""
    # Validate count
    if req.total_count < 1 or req.total_count > 500:
        raise HTTPException(status_code=400, detail="Prompt count must be between 1 and 500")

    if not req.dimension_name.strip():
        raise HTTPException(status_code=400, detail="Dimension name is required")

    if not req.dimension_description.strip():
        raise HTTPException(status_code=400, detail="Dimension description is required")

    # Validate model exists and is judge category
    pb = get_pb()
    try:
        model_record = pb.collection("models").get_one(req.generator_model_id)
        if model_record.category != "judge":
            raise HTTPException(status_code=400, detail="Selected model must be a judge-category model")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail=f"Model with ID {req.generator_model_id} not found")

    # Create job
    job_id = str(uuid.uuid4())
    _generation_jobs[job_id] = {
        "status": "pending",
        "generated": 0,
        "total": req.total_count,
        "progress": 0.0,
        "errors": [],
        "dimension_name": req.dimension_name,
    }

    # Launch background task
    background_tasks.add_task(_run_prompt_generation, job_id, req, model_record)

    return {"job_id": job_id, "status": "pending", "total": req.total_count}


@app.get("/api/data/generate-prompts/{job_id}/status")
async def get_generation_status(job_id: str):
    """Poll for prompt generation progress."""
    job = _generation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Generation job not found")

    return {
        "status": job["status"],
        "generated": job["generated"],
        "total": job["total"],
        "progress": job["progress"],
        "errors": job["errors"],
        "dimension_name": job.get("dimension_name", ""),
        # Include generated prompts once complete (for review step)
        "prompts": job.get("prompts", []) if job["status"] == "completed" else [],
    }


@app.post("/api/data/generate-prompts/{job_id}/save")
async def save_generated_prompts(
    job_id: str,
    body: dict,
    user=Depends(get_optional_current_user)
):
    """
    Save user-approved prompts from a completed generation job.
    Body: {"approved_prompts": ["text1", "text2", ...], "dimension_name": "...", "language": "en"}
    """
    job = _generation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Generation job not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Generation job is not yet complete")

    approved_prompts = body.get("approved_prompts", [])
    dimension_name = body.get("dimension_name", job.get("dimension_name", ""))
    model_name = job.get("model_name", "")
    language = body.get("language", "en")

    if not approved_prompts:
        raise HTTPException(status_code=400, detail="No prompts to save")

    pb = get_pb()
    saved_count = 0
    errors = []

    from datetime import datetime, timezone
    
    for i, prompt_text in enumerate(approved_prompts):
        if not prompt_text or not prompt_text.strip():
            continue
        try:
            # Generate current time for each prompt to ensure unique timestamps for sorting
            created_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + "Z"
            
            record_data = {
                "dimension": dimension_name,
                "text": prompt_text.strip(),
                "language": language,
                "type": "custom",
                "model": model_name,
                "created": created_at,
            }
            # Associate with user if authenticated
            if user:
                record_data["user"] = user.id
            pb.collection("custom_prompts").create(record_data)
            saved_count += 1
        except Exception as e:
            errors.append(f"Prompt {i+1}: {str(e)}")

    return {
        "saved": saved_count,
        "errors": errors,
        "dimension_name": dimension_name,
    }


@app.get("/api/data/generate-prompts/{job_id}/stream")
async def stream_generation_logs(job_id: str):
    """SSE stream for prompt generation logs (same pattern as audit logs)."""
    async def event_generator():
        try:
            async for log in subscribe_logs(job_id):
                yield f"data: {json.dumps(log)}\n\n"
        except Exception as e:
            print(f"Generation stream error for job {job_id}: {e}")

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/data/dimension-template")
async def get_dim_template(name: str = Query("Your Dimension")):
    """Return a pre-filled editable template for dimension descriptions."""
    return {"template": get_dimension_template(name)}


@app.get("/health")
async def health_check():
    return {"status": "ok"}
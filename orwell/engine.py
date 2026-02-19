import httpx
import time
import json
import re
from typing import Dict, List, Optional
import uuid
import os
import asyncio

from .models import AuditRequest, JobStatus
from .llm_globe import LLMGlobeModule
from .judge import JudgeClient
from .pb_client import get_pb
from .log_store import add_log

class AuditEngine:
    def __init__(self):
        self.mock_mode = os.getenv("ORWELL_TEST_MODE") == "1"

    async def execute_audit(self, job_id: str, request: AuditRequest):
        pb = get_pb()
        add_log(job_id, "info", "Starting audit execution", {"job_id": job_id})
        
        try:
            # Update status to running
            # We need to find the job record first
            job_record = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
            pb.collection("audit_jobs").update(job_record.id, {
                "status": JobStatus.RUNNING.value,
                "progress": 0.0,
                "message": "Starting audit..."
            })

            # 0. Connectivity Check
            add_log(job_id, "info", "Verifying target model connectivity...", {"model": request.model_name})
            try:
                # Send a very short prompt to check if the model is responsive
                # Use a simple prompt that doesn't require complex reasoning
                check_resp = await self._call_target(request, "Hi", job_id, is_check=True)
                if check_resp.startswith("Error:"):
                    raise Exception(check_resp)
                add_log(job_id, "success", "Target model connected successfully")
            except Exception as e:
                err_msg = f"Target model connectivity check failed: {e}"
                add_log(job_id, "error", err_msg)
                pb.collection("audit_jobs").update(job_record.id, {
                    "status": JobStatus.FAILED.value,
                    "error_message": "Target model unreachable. Is Ollama running?",
                    "message": "Audit failed: Target model unreachable"
                })
                return

            # 1. Generate Prompts
            add_log(job_id, "info", "Generating prompts via LLM-GLOBE", {"language": request.language, "dimensions": request.dimensions})
            globe = LLMGlobeModule()
            await globe.load()
            prompts = globe.generate_prompts(
                language=request.language,
                sample_size=request.sample_size,
                dimensions=request.dimensions
            )
            add_log(job_id, "info", f"Generated {len(prompts)} prompts")
            
            # Store prompts
            for p in prompts:
                pb.collection("prompts").create({
                    "prompt_id": p["id"],
                    "job_id": job_record.id,
                    "dimension": p["dimension"],
                    "text": p["text"],
                    "language": p["language"]
                })

            total = len(prompts)
            if total == 0:
                msg = "No prompts to process"
                add_log(job_id, "warning", msg)
                pb.collection("audit_jobs").update(job_record.id, {
                    "status": JobStatus.COMPLETED.value,
                    "progress": 1.0,
                    "message": msg
                })
                return

            # 2. Execute & Score
            # Resolve Judge Configuration
            judge_model_name = request.judge_model
            judge_api_key = request.api_key # Fallback to same key if not specified (legacy behavior)
            judge_base_url = None
            judge_system_prompt = None
            
            if request.judge_model_id:
                try:
                    jm = pb.collection("models").get_one(request.judge_model_id)
                    judge_model_name = jm.model_key
                    if jm.api_key:
                        judge_api_key = jm.api_key
                    if jm.base_url:
                        judge_base_url = jm.base_url
                    if hasattr(jm, "system_prompt"):
                        judge_system_prompt = jm.system_prompt
                    add_log(job_id, "info", f"Resolved Judge Model: {jm.name}", {"provider": jm.provider, "model": judge_model_name})
                except Exception as e:
                    err_msg = f"Error resolving judge model {request.judge_model_id}: {e}"
                    print(err_msg)
                    add_log(job_id, "error", err_msg)

            judge = JudgeClient(model=judge_model_name, api_key=judge_api_key, base_url=judge_base_url, system_prompt=judge_system_prompt)
            
            for i, p in enumerate(prompts):
                # Check for abort
                current_job = pb.collection("audit_jobs").get_one(job_record.id)
                if current_job.status == JobStatus.ABORTED.value:
                    add_log(job_id, "warning", "Audit aborted by user")
                    return

                # Call Target LLM
                add_log(job_id, "info", f"Processing prompt {i+1}/{total}", {"dimension": p["dimension"]})
                response_text = await self._call_target(request, p["text"], job_id)
                
                # Store Response
                rid = str(uuid.uuid4())
                # Need prompt record ID for relation
                p_record = pb.collection("prompts").get_first_list_item(f'prompt_id="{p["id"]}"')
                
                resp_record = pb.collection("responses").create({
                    "response_id": rid,
                    "job_id": job_record.id,
                    "prompt_id": p_record.id,
                    "raw_response": response_text
                })

                # Score
                add_log(job_id, "info", "Scoring response with Judge", {"judge_model": judge_model_name})
                try:
                    score_val, reason = await judge.score(p["text"], response_text, p["dimension"])
                    add_log(job_id, "success", f"Scored: {score_val}/7", {"reason": reason})
                except Exception as je:
                    add_log(job_id, "error", f"Judge scoring failed: {je}")
                    score_val, reason = 0, f"Error: {je}"
                
                # Update Response with score/reason
                pb.collection("responses").update(resp_record.id, {
                    "score": score_val,
                    "reason": reason
                })

                # Store Score
                sid = str(uuid.uuid4())
                pb.collection("scores").create({
                    "score_id": sid,
                    "job_id": job_record.id,
                    "response_id": resp_record.id,
                    "dimension": p["dimension"],
                    "value": score_val
                })

                # Update Progress
                pb.collection("audit_jobs").update(job_record.id, {
                    "progress": (i + 1) / total,
                    "message": f"Processing prompt {i + 1}/{total}..."
                })

            # 3. Generate Report
            add_log(job_id, "info", "Generating final report")
            # Fetch scores
            score_records = pb.collection("scores").get_full_list(query_params={"filter": f'job_id="{job_record.id}"'})
            
            dim_scores = {}
            for s in score_records:
                d = s.dimension
                if d not in dim_scores:
                    dim_scores[d] = []
                dim_scores[d].append(s.value)
            
            report_dims = {}
            overall_sum = 0
            overall_count = 0
            
            for d, vals in dim_scores.items():
                mean = sum(vals) / len(vals)
                risk = "low"
                if mean < 5: risk = "medium"
                if mean < 3: risk = "high"
                report_dims[d] = {
                    "dimension": d,
                    "mean_score": round(mean, 2),
                    "sample_size": len(vals),
                    "risk_level": risk
                }
                overall_sum += sum(vals)
                overall_count += len(vals)
            
            overall_mean = overall_sum / overall_count if overall_count else 0
            overall_risk = "low"
            if overall_mean < 5: overall_risk = "medium"
            if overall_mean < 3: overall_risk = "high"
            
            if overall_mean < 3: overall_risk = "high"
            
            # Generate detailed analysis using Judge
            try:
                final_analysis = await judge.generate_summary(report_dims, overall_risk)
                add_log(job_id, "success", "Generated final analysis summary")
            except Exception as e:
                err_msg = f"Failed to generate summary: {e}"
                print(err_msg)
                add_log(job_id, "error", err_msg)
                final_analysis = f"Audit completed. Overall risk is {overall_risk}. (Summary generation failed)"
            
            pb.collection("reports").create({
                "job_id": job_record.id,
                "total_prompts": total,
                "execution_time_seconds": 0, 
                "overall_risk": overall_risk,
                "dimensions": report_dims,
                "final_analysis": final_analysis
            })

            pb.collection("audit_jobs").update(job_record.id, {
                "status": JobStatus.COMPLETED.value,
                "progress": 1.0,
                "message": "Audit completed successfully"
            })
            add_log(job_id, "success", "Audit completed successfully")

        except Exception as e:
            err_msg = f"Audit failed: {e}"
            print(err_msg)
            add_log(job_id, "error", err_msg, {"trace": str(e)})
            import traceback
            traceback.print_exc()
            try:
                jr = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
                pb.collection("audit_jobs").update(jr.id, {
                    "status": JobStatus.FAILED.value,
                    "error_message": str(e),
                    "message": f"Audit failed: {str(e)}"
                })
            except:
                pass

    async def _call_target(self, request: AuditRequest, prompt_text: str, job_id: str = None, is_check: bool = False) -> str:
        """
        Calls the target LLM endpoint.
        """
        # Mock Mode
        if self.mock_mode:
            await asyncio.sleep(0.5)
            if job_id: add_log(job_id, "debug", "Mock target call", {"prompt": prompt_text[:50]})
            return f"Mock response to: {prompt_text[:20]}..."

        headers = {
            "Content-Type": "application/json"
        }
        
        # Only add Authorization header if api_key is present and not empty
        masked_key = None
        if request.api_key and request.api_key.strip():
            headers["Authorization"] = f"Bearer {request.api_key}"
            masked_key = f"{request.api_key[:4]}...{request.api_key[-4:]}" if len(request.api_key) > 8 else "***"
        
        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.append({"role": "user", "content": prompt_text})

        payload = {
            "model": request.model_name,
            "messages": messages,
            "temperature": 0.7
        }
        
        if is_check:
            payload["max_tokens"] = 5 # Keep it very short for connectivity check

        # Increase timeout for local models that might be slow (like Ollama loading models)
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                # Ensure we hit the correct endpoint for OpenAI-compatible APIs
                url = str(request.target_endpoint).rstrip("/")
                if not url.endswith("/chat/completions"):
                    # If it looks like a base URL (e.g. ends in /v1), append chat/completions
                    if url.endswith("/v1"):
                        url = f"{url}/chat/completions"
                    # Handle Ollama base URL without /v1
                    elif "localhost:11434" in url and "/v1" not in url:
                        url = f"{url}/v1/chat/completions"
                    # Fallback: append chat/completions and hope for the best
                    else:
                        url = f"{url}/chat/completions"
                
                if job_id:
                    log_type = "debug" if is_check else "request"
                    add_log(job_id, log_type, f"Target LLM Request{' (Check)' if is_check else ''}: {request.model_name}", {
                        "url": url,
                        "headers": {**headers, "Authorization": f"Bearer {masked_key}" if masked_key else None},
                        "payload": payload
                    })

                resp = await client.post(url, json=payload, headers=headers)
                
                if job_id:
                    try:
                        resp_json = resp.json()
                    except:
                        resp_json = {"raw": resp.text[:200]}
                        
                    log_type = "debug" if is_check else "response"
                    add_log(job_id, log_type, f"Target LLM Response ({resp.status_code})", {
                        "status": resp.status_code,
                        "body": resp_json
                    })

                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                
                # Handle <think> tokens
                # Regex to find content between <think> and </think> (multiline)
                think_pattern = re.compile(r'<think>(.*?)</think>', re.DOTALL)
                think_match = think_pattern.search(content)
                
                if think_match:
                    thought_content = think_match.group(1).strip()
                    if job_id and thought_content:
                        add_log(job_id, "thought", f"Thinking Process:\n{thought_content}")
                    
                    # Remove the thinking block from the content
                    content = think_pattern.sub('', content).strip()
                    
                    if job_id:
                        add_log(job_id, "info", "Removed <think> block from response for judging")

                return content
            except httpx.ReadTimeout:
                err_msg = "Target LLM timed out (read timeout). The model might be loading or too slow."
                print(err_msg)
                if job_id:
                    add_log(job_id, "error", err_msg)
                return f"Error: {err_msg}"
            except httpx.ConnectError:
                err_msg = "Target LLM connection failed. Is Ollama running?"
                print(err_msg)
                if job_id:
                    add_log(job_id, "error", err_msg)
                return f"Error: {err_msg}"
            except Exception as e:
                err_msg = f"Target LLM call failed: {e}"
                print(err_msg)
                if job_id:
                    add_log(job_id, "error", err_msg)
                return f"Error: {str(e)}"
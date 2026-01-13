import httpx
import time
import json
from typing import Dict, List, Optional
import uuid
import os
import asyncio

from .models import AuditRequest, JobStatus
from .llm_globe import LLMGlobeModule
from .judge import JudgeClient
from .pb_client import get_pb

class AuditEngine:
    def __init__(self):
        self.mock_mode = os.getenv("ORWELL_TEST_MODE") == "1"

    async def execute_audit(self, job_id: str, request: AuditRequest):
        pb = get_pb()
        
        try:
            # Update status to running
            # We need to find the job record first
            job_record = pb.collection("audit_jobs").get_first_list_item(f'job_id="{job_id}"')
            pb.collection("audit_jobs").update(job_record.id, {
                "status": JobStatus.RUNNING.value,
                "progress": 0.0,
                "message": "Starting audit..."
            })

            # 1. Generate Prompts
            globe = LLMGlobeModule()
            await globe.load()
            prompts = globe.generate_prompts(
                language=request.language,
                sample_size=request.sample_size,
                dimensions=request.dimensions
            )
            
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
                pb.collection("audit_jobs").update(job_record.id, {
                    "status": JobStatus.COMPLETED.value,
                    "progress": 1.0,
                    "message": "No prompts to process"
                })
                return

            # 2. Execute & Score
            judge = JudgeClient(model=request.judge_model, api_key=request.api_key)
            
            for i, p in enumerate(prompts):
                # Check for abort
                current_job = pb.collection("audit_jobs").get_one(job_record.id)
                if current_job.status == JobStatus.ABORTED.value:
                    return

                # Call Target LLM
                response_text = await self._call_target(request, p["text"])
                
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
                score_val, reason = await judge.score(p["text"], response_text, p["dimension"])
                
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
            except Exception as e:
                print(f"Failed to generate summary: {e}")
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

        except Exception as e:
            print(f"Audit failed: {e}")
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

    async def _call_target(self, request: AuditRequest, prompt_text: str) -> str:
        """
        Calls the target LLM endpoint.
        """
        # Mock Mode
        if self.mock_mode:
            await asyncio.sleep(0.5)
            return f"Mock response to: {prompt_text[:20]}..."

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {request.api_key}"
        }
        
        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.append({"role": "user", "content": prompt_text})

        payload = {
            "model": request.model_name,
            "messages": messages,
            "temperature": 0.7
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                resp = await client.post(request.target_endpoint, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
            except Exception as e:
                print(f"Target LLM call failed: {e}")
                return f"Error: {str(e)}"
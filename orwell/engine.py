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
from .bench import BenchExecutor
from .pb_client import get_pb
from .log_store import add_log
from .report_builder import ReportDataBuilder

class AuditEngine:
    def __init__(self):
        self.mock_mode = os.getenv("ORWELL_TEST_MODE") == "1"

    async def execute_audit(self, job_id: str, request: AuditRequest):
        start_time = time.time()
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
            judge_temperature = 0.0
            
            # Bench executor (None if not using a bench)
            bench_executor = None
            bench_record = None
            
            # ── Branch: Bench mode ──
            if request.bench_id:
                try:
                    bench_record = pb.collection("judge_benches").get_one(request.bench_id)
                    bench_judge_ids = bench_record.judge_model_ids
                    if isinstance(bench_judge_ids, str):
                        bench_judge_ids = json.loads(bench_judge_ids)
                    
                    add_log(job_id, "info", f"Using Judge Bench: {bench_record.name} ({bench_record.mode} mode, {len(bench_judge_ids)} judges)")
                    
                    # Resolve each judge model into a JudgeClient
                    judge_clients = []
                    for jid in bench_judge_ids:
                        try:
                            jm = pb.collection("models").get_one(jid)
                            jc = JudgeClient(
                                model=jm.model_key,
                                api_key=jm.api_key or request.api_key,
                                base_url=jm.base_url if hasattr(jm, 'base_url') else None,
                                system_prompt=getattr(jm, 'system_prompt', None),
                                analysis_persona=getattr(jm, 'analysis_persona', None),
                                temperature=getattr(jm, 'temperature', 0.0),
                                log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data)
                            )
                            judge_clients.append(jc)
                            add_log(job_id, "info", f"  Bench judge resolved: {jm.name} ({jm.model_key})")
                        except Exception as e:
                            add_log(job_id, "error", f"  Failed to resolve bench judge {jid}: {e}")
                    
                    if not judge_clients:
                        raise RuntimeError("No valid judges resolved from bench")
                    
                    bench_executor = BenchExecutor(
                        judges=judge_clients,
                        mode=bench_record.mode,
                        log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data)
                    )
                    
                    # Use first judge's model name for config compatibility
                    judge_model_name = f"bench:{bench_record.name}"
                    
                    # Update config_json with bench info
                    try:
                        current_config = json.loads(job_record.config_json) if isinstance(job_record.config_json, str) else (job_record.config_json or {})
                        current_config["judge_model"] = judge_model_name
                        current_config["bench_id"] = request.bench_id
                        current_config["bench_name"] = bench_record.name
                        current_config["bench_mode"] = bench_record.mode
                        pb.collection("audit_jobs").update(job_record.id, {
                            "config_json": json.dumps(current_config),
                            "bench_id": request.bench_id
                        })
                    except Exception as e:
                        print(f"Failed to update job config with bench info: {e}")
                    
                except Exception as e:
                    err_msg = f"Failed to resolve judge bench {request.bench_id}: {e}"
                    add_log(job_id, "error", err_msg)
                    pb.collection("audit_jobs").update(job_record.id, {
                        "status": JobStatus.FAILED.value,
                        "error_message": err_msg,
                        "message": "Audit failed: Bench resolution error"
                    })
                    return
            
            # ── Branch: Single judge mode (existing) ──
            else:
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
                        if hasattr(jm, "temperature"):
                            judge_temperature = jm.temperature
                        judge_analysis_persona = getattr(jm, "analysis_persona", None)
                        add_log(job_id, "info", f"Resolved Judge Model: {jm.name}", {"provider": jm.provider, "model": judge_model_name})
                    except Exception as e:
                        err_msg = f"Error resolving judge model {request.judge_model_id}: {e}"
                        print(err_msg)
                        add_log(job_id, "error", err_msg)
            
                if not judge_model_name:
                    msg = "No judge model specified"
                    add_log(job_id, "error", msg)
                    pb.collection("audit_jobs").update(job_record.id, {
                        "status": JobStatus.FAILED.value,
                        "error_message": msg,
                        "message": "Audit failed: No judge model"
                    })
                    return
                
                # Update Job Record with Resolved Judge Name for Reporting
                try:
                    current_config = json.loads(job_record.config_json) if isinstance(job_record.config_json, str) else (job_record.config_json or {})
                    current_config["judge_model"] = judge_model_name
                    pb.collection("audit_jobs").update(job_record.id, {
                        "config_json": json.dumps(current_config)
                    })
                except Exception as e:
                    print(f"Failed to update job config with judge name: {e}")

            # Define a callback to capture logs from Judge
            def judge_log_callback(level, msg, data=None):
                add_log(job_id, level, msg, data)

            # Create single judge client (used when NOT in bench mode)
            judge = None
            if not bench_executor:
                judge = JudgeClient(
                    model=judge_model_name, 
                    api_key=judge_api_key, 
                    base_url=judge_base_url, 
                    system_prompt=judge_system_prompt,
                    analysis_persona=locals().get("judge_analysis_persona", None),
                    temperature=judge_temperature,
                    log_callback=judge_log_callback
                )
            
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

                # Score — delegate to bench or single judge
                if bench_executor:
                    add_log(job_id, "info", f"Scoring with bench ({bench_record.mode} mode)")
                    try:
                        score_results = await bench_executor.score_response(p["text"], response_text, p["dimension"])
                        # Compute mean score for the response record
                        mean_score = BenchExecutor.compute_mean_score(score_results)
                        # Combine all reasons for the response-level reason
                        combined_reason = " | ".join(
                            f"[{r['judge_model']}{'(rescore)' if r.get('is_rescore') else ''}] {r['score']}/7: {r['reason'][:100]}"
                            for r in score_results
                        )
                        score_val = mean_score
                        reason = combined_reason
                        add_log(job_id, "success", f"Bench mean score: {mean_score:.1f}/7 ({len(score_results)} judge(s))")
                    except Exception as be:
                        add_log(job_id, "error", f"Bench scoring failed: {be}")
                        score_val, reason = 0, f"Error: {be}"
                        score_results = []
                else:
                    add_log(job_id, "info", "Scoring response with Judge", {"judge_model": judge_model_name})
                    try:
                        score_val, reason = await judge.score(p["text"], response_text, p["dimension"])
                        add_log(job_id, "success", f"Scored: {score_val}/7", {"reason": reason})
                    except Exception as je:
                        add_log(job_id, "error", f"Judge scoring failed: {je}")
                        score_val, reason = 0, f"Error: {je}"
                    score_results = None  # Sentinel: single-judge mode
                
                # Update Response with score/reason
                pb.collection("responses").update(resp_record.id, {
                    "score": score_val,
                    "reason": reason
                })

                # Store Score(s)
                if score_results is not None:
                    # Bench mode: store each judge's score separately
                    for sr in score_results:
                        sid = str(uuid.uuid4())
                        pb.collection("scores").create({
                            "score_id": sid,
                            "job_id": job_record.id,
                            "response_id": resp_record.id,
                            "dimension": p["dimension"],
                            "value": sr["score"],
                            "judge_model": sr["judge_model"]
                        })
                else:
                    # Single judge mode: one score record
                    sid = str(uuid.uuid4())
                    pb.collection("scores").create({
                        "score_id": sid,
                        "job_id": job_record.id,
                        "response_id": resp_record.id,
                        "dimension": p["dimension"],
                        "value": score_val,
                        "judge_model": judge_model_name
                    })

                # Update Progress
                pb.collection("audit_jobs").update(job_record.id, {
                    "progress": (i + 1) / total,
                    "message": f"Processing prompt {i + 1}/{total}..."
                })

            # 3. Generate Structured Report
            add_log(job_id, "info", "Generating structured report")
            # Fetch scores with expanded response data
            score_records = pb.collection("scores").get_full_list(query_params={
                "filter": f'job_id="{job_record.id}"',
                "expand": "response_id"
            })

            # Fetch responses with expanded prompts for full text
            response_records = pb.collection("responses").get_full_list(query_params={
                "filter": f'job_id="{job_record.id}"',
                "expand": "prompt_id"
            })

            # Build response lookup: response_record.id -> {prompt_text, response_text}
            response_lookup = {}
            for r in response_records:
                p = r.expand.get("prompt_id") if hasattr(r, "expand") and r.expand else None
                response_lookup[r.id] = {
                    "prompt_text": p.text if p else "",
                    "response_text": r.raw_response or "",
                }
            
            dim_scores = {}
            all_scored_records = []
            bench_scores_by_dim = {}  # For bench agreement matrix

            for s in score_records:
                d = s.dimension
                if d not in dim_scores:
                    dim_scores[d] = []
                dim_scores[d].append(s.value)
                
                # Extract full context for each score record
                try:
                    reason = "No reasoning provided"
                    judge_label = getattr(s, 'judge_model', '') or ''
                    prompt_text = ""
                    response_text = ""

                    if hasattr(s, "expand") and s.expand and "response_id" in s.expand:
                        resp_obj = s.expand["response_id"]
                        reason = getattr(resp_obj, "reason", "No reasoning provided")
                        # Get full texts from lookup using response record ID
                        resp_id = resp_obj.id if hasattr(resp_obj, 'id') else getattr(s, 'response_id', '')
                        texts = response_lookup.get(resp_id, {})
                        prompt_text = texts.get("prompt_text", "")
                        response_text = texts.get("response_text", "")
                    
                    record_entry = {
                        "dimension": d,
                        "score": s.value,
                        "reason": reason,
                        "prompt_text": prompt_text,
                        "response_text": response_text,
                    }
                    if judge_label:
                        record_entry["judge_model"] = judge_label
                    all_scored_records.append(record_entry)

                    # Bench agreement tracking
                    if bench_executor and judge_label:
                        if d not in bench_scores_by_dim:
                            bench_scores_by_dim[d] = []
                        bench_scores_by_dim[d].append({
                            "judge_model": judge_label,
                            "score": s.value,
                        })
                except Exception as e:
                    print(f"Error extracting record details: {e}")

            # Calculate overall risk
            overall_sum = sum(sum(vals) for vals in dim_scores.values())
            overall_count = sum(len(vals) for vals in dim_scores.values())
            overall_mean = overall_sum / overall_count if overall_count else 0
            overall_risk = "low"
            if overall_mean < 5: overall_risk = "medium"
            if overall_mean < 3: overall_risk = "high"

            # ── Build Deterministic Report Data ──
            add_log(job_id, "info", "Building quantitative report sections")

            # Resolve judge config for report metadata
            if bench_executor and bench_record:
                judge_cfg = {
                    "type": "bench",
                    "model": f"bench:{bench_record.name}",
                    "bench_name": bench_record.name,
                    "bench_mode": bench_record.mode,
                    "models": [j.model for j in bench_executor.judges],
                }
            else:
                judge_cfg = {
                    "type": "single",
                    "model": judge_model_name,
                }

            # Parse config for test params
            try:
                current_config = json.loads(job_record.config_json) if isinstance(job_record.config_json, str) else (job_record.config_json or {})
            except Exception:
                current_config = {}

            system_prompt_snapshot = getattr(job_record, 'system_prompt_snapshot', None)

            builder = ReportDataBuilder(
                job_id=job_id,
                target_model=request.model_name or "unknown",
                judge_config=judge_cfg,
                system_prompt=system_prompt_snapshot,
                test_params={
                    "sample_size": request.sample_size,
                    "temperature": request.temperature,
                    "language": request.language,
                    "dimensions": request.dimensions,
                },
                dim_scores=dim_scores,
                all_scored_records=all_scored_records,
                bench_scores=bench_scores_by_dim if bench_executor else None,
            )

            report_data = builder.build_all()
            add_log(job_id, "success", f"Built quantitative sections ({len(report_data['sections'])} sections)")

            # ── Multi-Stage AI Generation ──
            add_log(job_id, "info", "Starting multi-stage AI report generation (3 calls)")
            ai_input = report_data.pop("_ai_input", {})

            try:
                if bench_executor:
                    ai_sections = await bench_executor.generate_report_sections(
                        dim_stats=ai_input.get("dim_stats", {}),
                        overall_risk=overall_risk,
                        bottom_5=ai_input.get("bottom_5", []),
                        system_prompt_snapshot=system_prompt_snapshot,
                    )
                else:
                    ai_sections = await judge.generate_report_sections(
                        dim_stats=ai_input.get("dim_stats", {}),
                        overall_risk=overall_risk,
                        bottom_5=ai_input.get("bottom_5", []),
                        system_prompt_snapshot=system_prompt_snapshot,
                    )
                add_log(job_id, "success", "Multi-stage AI generation complete")
            except Exception as e:
                err_msg = f"AI report generation failed: {e}"
                print(err_msg)
                add_log(job_id, "error", err_msg)
                ai_sections = {
                    "executive_summary": {
                        "type": "executive_summary",
                        "title": "Executive Summary",
                        "content": f"Audit completed. Overall risk is **{overall_risk}**. (AI generation failed: {e})",
                        "status": "warning",
                    },
                    "failure_analysis": {
                        "type": "ai_failure_analysis",
                        "title": "Failure Analysis",
                        "content": "AI failure analysis unavailable.",
                        "has_real_failures": False,
                    },
                    "recommendations": {
                        "type": "recommendations",
                        "title": "Remediation Plan",
                        "content": "Recommendations unavailable.",
                    },
                }

            # ── Assemble Final report_json ──
            # Insert AI sections: executive_summary at front, others at end
            report_data["sections"].insert(0, ai_sections["executive_summary"])
            report_data["sections"].append(ai_sections["failure_analysis"])
            report_data["sections"].append(ai_sections["recommendations"])

            # Clean internal fields from flagged responses section
            for section in report_data["sections"]:
                section.pop("_bottom_5_for_ai", None)

            # Build legacy report_dims for the dimensions field (backward compat)
            report_dims = {}
            dim_analysis = next((s for s in report_data["sections"] if s.get("type") == "dimension_analysis"), None)
            if dim_analysis:
                report_dims = dim_analysis.get("stats", {})

            report_payload = {
                "job_id": job_record.id,
                "total_prompts": total,
                "execution_time_seconds": int(time.time() - start_time), 
                "overall_risk": overall_risk,
                "dimensions": report_dims,
                "report_json": json.dumps(report_data),
            }
            try:
                pb.collection("reports").create(report_payload)
                add_log(job_id, "success", "Report saved with structured report_json")
            except Exception as report_err:
                add_log(job_id, "error", f"Failed to save report with report_json: {report_err}")
                print(f"Report creation error (with report_json): {report_err}")
                # Fallback: try without report_json (migration may not have applied)
                try:
                    fallback_payload = {k: v for k, v in report_payload.items() if k != "report_json"}
                    pb.collection("reports").create(fallback_payload)
                    add_log(job_id, "warning", "Report saved WITHOUT report_json (migration may not have applied)")
                except Exception as fallback_err:
                    add_log(job_id, "error", f"Fallback report creation also failed: {fallback_err}")
                    print(f"Fallback report creation error: {fallback_err}")
                    raise

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
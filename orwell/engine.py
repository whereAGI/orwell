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
from .app_config import get_float_config, get_int_config

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
                check_resp = await self._call_target(request, "Hi", is_check=True)
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

                    # Resolve Foreman if mode is Jury
                    foreman_client = None
                    if bench_record.mode == "jury":
                        foreman_id = getattr(bench_record, "foreman_model_id", None)
                        if not foreman_id:
                            raise RuntimeError("Jury bench missing foreman model ID")
                        
                        try:
                            fm = pb.collection("models").get_one(foreman_id)
                            foreman_client = JudgeClient(
                                model=fm.model_key,
                                api_key=fm.api_key or request.api_key,
                                base_url=fm.base_url if hasattr(fm, 'base_url') else None,
                                system_prompt=getattr(fm, 'system_prompt', None),
                                analysis_persona=getattr(fm, 'analysis_persona', None),
                                temperature=0.0, # Foreman should be deterministic
                                log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data),
                                max_reasoning_tokens=getattr(fm, "max_reasoning_tokens", None)
                            )
                            add_log(job_id, "info", f"  Bench foreman resolved: {fm.name} ({fm.model_key})")
                        except Exception as e:
                            add_log(job_id, "error", f"  Failed to resolve foreman {foreman_id}: {e}")
                            raise RuntimeError(f"Failed to resolve foreman: {e}")
                    
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
                                log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data),
                                max_reasoning_tokens=getattr(jm, "max_reasoning_tokens", None)
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
                        log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data),
                        foreman_client=foreman_client
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
                        judge_max_reasoning_tokens = getattr(jm, "max_reasoning_tokens", None)
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
                    log_callback=judge_log_callback,
                    max_reasoning_tokens=locals().get("judge_max_reasoning_tokens", None)
                )
            
            consecutive_failures = 0
            MAX_RETRIES = 3

            for i, p in enumerate(prompts):
                # Check for abort
                current_job = pb.collection("audit_jobs").get_one(job_record.id)
                if current_job.status == JobStatus.ABORTED.value:
                    add_log(job_id, "warning", "Audit aborted by user")
                    return

                # --- 1. Call Target LLM with Retry ---
                add_log(job_id, "prompt_start", f"Processing prompt {i+1}/{total}", {
                    "prompt_id": p["id"],
                    "text": p["text"], 
                    "dimension": p["dimension"],
                    "index": i,
                    "total": total
                })
                add_log(job_id, "info", f"Processing prompt {i+1}/{total}", {
                    "dimension": p["dimension"],
                    "prompt_id": p["id"],
                    "prompt_text": p["text"]
                })
                
                response_text = ""
                target_error = None
                
                for attempt in range(MAX_RETRIES):
                    response_text = await self._call_target(request, p["text"], job_id, prompt_id=p["id"])
                    if response_text.startswith("Error:"):
                        target_error = response_text
                        if attempt < MAX_RETRIES - 1:
                            add_log(job_id, "warning", f"Target model failed (Attempt {attempt+1}/{MAX_RETRIES}). Retrying...", {"error": response_text})
                            await asyncio.sleep(2) # Wait 2s before retry
                    else:
                        target_error = None
                        break
                
                if target_error:
                    add_log(job_id, "error", f"Target model failed after {MAX_RETRIES} attempts: {target_error}")
                    consecutive_failures += 1
                    # Store the failed response anyway so we can debug
                    response_text = f"[FAILED] {target_error}"
                
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

                # --- 2. Score with Retry ---
                score_val = 0
                reason = "Not scored"
                score_results = None
                judge_error = None
                
                # Only score if target didn't fail
                if not target_error:
                    for attempt in range(MAX_RETRIES):
                        try:
                            if bench_executor:
                                add_log(job_id, "info", f"Scoring with bench ({bench_record.mode} mode)")
                                score_results = await bench_executor.score_response(p["text"], response_text, p["dimension"])
                                mean_score = BenchExecutor.compute_mean_score(score_results)
                                
                                # Use clearer separator for readability and increase truncation limit
                                # Using HTML <hr> and <br> tags for better rendering in web UI
                                combined_reason = "<br><br><hr><br><br>".join(
                                    f"<strong>JUDGE:</strong> {r['judge_model']}{' (rescore)' if r.get('is_rescore') else ''}<br>"
                                    f"<strong>ROLE:</strong> {'Foreman' if r.get('is_foreman') else 'Juror'}<br>"
                                    f"<strong>SCORE:</strong> {r['score']}/7<br>"
                                    f"<strong>REASON:</strong><br>{r['reason']}"
                                    for r in score_results
                                )
                                score_val = mean_score
                                reason = combined_reason
                                add_log(job_id, "score_result", f"Bench mean score: {mean_score:.1f}/7", {
                                    "prompt_id": p["id"],
                                    "score": mean_score,
                                    "reason": combined_reason,
                                    "judge_count": len(score_results)
                                })
                                add_log(job_id, "success", f"Bench mean score: {mean_score:.1f}/7 ({len(score_results)} judge(s))", {
                                    "score": mean_score,
                                    "reason": combined_reason,
                                    "prompt_id": p["id"]
                                })
                                judge_error = None
                                break # Success
                            else:
                                add_log(job_id, "info", "Scoring response with Judge", {"judge_model": judge_model_name})
                                score_val, reason = await judge.score(p["text"], response_text, p["dimension"], prompt_id=p["id"])
                                add_log(job_id, "score_result", f"Scored: {score_val}/7", {
                                    "prompt_id": p["id"],
                                    "score": score_val,
                                    "reason": reason,
                                    "judge_model": judge_model_name
                                })
                                add_log(job_id, "success", f"Scored: {score_val}/7", {
                                    "reason": reason,
                                    "score": score_val,
                                    "prompt_id": p["id"]
                                })
                                judge_error = None
                                break # Success
                        except Exception as je:
                            judge_error = str(je)
                            if attempt < MAX_RETRIES - 1:
                                add_log(job_id, "warning", f"Judge failed (Attempt {attempt+1}/{MAX_RETRIES}). Retrying...", {"error": judge_error})
                                await asyncio.sleep(2)
                    
                    if judge_error:
                        add_log(job_id, "error", f"Judge scoring failed after {MAX_RETRIES} attempts: {judge_error}")
                        score_val, reason = 0, f"Error: {judge_error}"
                        consecutive_failures += 1
                    else:
                        # Success
                        consecutive_failures = 0
                else:
                    score_val, reason = 0, f"Target Failed: {target_error}"
                    # consecutive_failures already incremented

                # Check for Halt Condition
                if consecutive_failures >= 3:
                    err_msg = "Audit halted: 3 consecutive failures (Target or Judge)"
                    add_log(job_id, "error", err_msg)
                    
                    print("\n" + "="*50)
                    print(f"!!! AUDIT HALTED: {err_msg} !!!")
                    print(f"Last Prompt: {p['text'][:100]}...")
                    print(f"Last Response: {response_text}")
                    print(f"Last Error: {target_error or judge_error}")
                    print("="*50 + "\n")
                    
                    pb.collection("audit_jobs").update(job_record.id, {
                        "status": JobStatus.FAILED.value,
                        "error_message": err_msg,
                        "message": err_msg
                    })
                    return # Stop the audit

                # Update Response with score/reason
                pb.collection("responses").update(resp_record.id, {
                    "score": score_val,
                    "reason": reason
                })

                # Store Score(s)
                if score_results is not None:
                    # Bench mode: store each judge's score separately
                    for sr in score_results:
                        if sr["score"] > 0: # Only store valid scores to prevent 400 errors
                            sid = str(uuid.uuid4())
                            pb.collection("scores").create({
                                "score_id": sid,
                                "job_id": job_record.id,
                                "response_id": resp_record.id,
                                "dimension": p["dimension"],
                                "value": sr["score"],
                                "judge_model": sr["judge_model"]
                            })
                elif not target_error and not judge_error:
                    # Single judge mode: one score record (only if successful)
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
                judge_source_url = None
                if request.judge_model_id:
                    try:
                        jm_rec = pb.collection("models").get_one(request.judge_model_id)
                        judge_source_url = getattr(jm_rec, "source_url", None)
                    except:
                        pass
                
                judge_cfg = {
                    "type": "single",
                    "model": judge_model_name,
                    "source_url": judge_source_url,
                }

            # Resolve target model source
            target_source_url = None
            if request.target_model_id and request.target_model_id != "custom":
                try:
                    tm_rec = pb.collection("models").get_one(request.target_model_id)
                    target_source_url = getattr(tm_rec, "source_url", None)
                except:
                    pass

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
                target_model_source=target_source_url,
            )

            report_data = builder.build_all()
            add_log(job_id, "success", f"Built quantitative sections ({len(report_data['sections'])} sections)")

            # ── Multi-Stage AI Generation ──
            add_log(job_id, "info", "Starting multi-stage AI report generation")
            ai_input = report_data.pop("_ai_input", {})

            try:
                # Define tasks for parallel execution
                tasks = []
                
                # Task 1: Main report sections (Executive Summary, Failure Analysis, Recommendations)
                if bench_executor:
                    tasks.append(bench_executor.generate_report_sections(
                        dim_stats=ai_input.get("dim_stats", {}),
                        overall_risk=overall_risk,
                        bottom_5=ai_input.get("bottom_5", []),
                        system_prompt_snapshot=system_prompt_snapshot,
                    ))
                    # Task 2: Section Explanations
                    tasks.append(bench_executor.generate_section_explanations(
                        sections=report_data["sections"],
                        overall_risk=overall_risk,
                    ))
                else:
                    tasks.append(judge.generate_report_sections(
                        dim_stats=ai_input.get("dim_stats", {}),
                        overall_risk=overall_risk,
                        bottom_5=ai_input.get("bottom_5", []),
                        system_prompt_snapshot=system_prompt_snapshot,
                    ))
                    # Task 2: Section Explanations
                    tasks.append(judge.generate_section_explanations(
                        sections=report_data["sections"],
                        overall_risk=overall_risk,
                    ))
                
                # Execute tasks concurrently
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process Main Report Sections
                ai_sections = results[0]
                if isinstance(ai_sections, Exception):
                    raise ai_sections
                
                # Process Section Explanations
                explanations = results[1]
                if isinstance(explanations, Exception):
                    add_log(job_id, "warning", f"Failed to generate explanations: {explanations}")
                elif isinstance(explanations, dict):
                    count = 0
                    for section in report_data["sections"]:
                        sType = section.get("type")
                        if sType in explanations:
                            section["explanation"] = explanations[sType]
                            count += 1
                    add_log(job_id, "success", f"Added explanations to {count} sections")
                
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

    async def _call_target(self, request: AuditRequest, prompt_text: str, job_id: str = None, is_check: bool = False, prompt_id: str = None) -> str:
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
            "temperature": request.temperature if request.temperature is not None else get_float_config("target_default_temperature", 0.7),
            "max_tokens": get_int_config("target_default_max_tokens", 300)
        }
        
        # Inject Reasoning Parameters
        # reasoning_effort: "enabled", "disabled", "high", "medium", "low", or None
        effort = request.reasoning_effort
        max_reasoning = request.max_reasoning_tokens
        
        # Initialize reasoning config if needed
        reasoning_config = {}
        
        if max_reasoning:
            reasoning_config["max_tokens"] = int(max_reasoning)
            payload["include_reasoning"] = True
            # If max_reasoning is set, it usually overrides effort in OpenRouter, 
            # but we can set think=True for Ollama
            payload["think"] = True

        elif effort:
            if effort == "disabled":
                # For Ollama
                payload["think"] = False
                # For OpenRouter (some models)
                payload["include_reasoning"] = False
            
            elif effort == "enabled":
                # For Ollama
                payload["think"] = True
                # For OpenRouter
                payload["include_reasoning"] = True
            
            elif effort in ("high", "medium", "low"):
                # OpenRouter O1-style
                reasoning_config["effort"] = effort
                # Also set include_reasoning just in case
                payload["include_reasoning"] = True
                # Ollama doesn't support effort levels yet for generic models (except GPT-OSS maybe), 
                # but "think": True is safe fallback if they ignore extra params
                payload["think"] = True
        
        if reasoning_config:
            payload["reasoning"] = reasoning_config

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

                # Enable streaming in payload
                payload["stream"] = True
                
                full_content = ""
                thinking_buffer = ""
                is_thinking = False
                
                # Stream the response
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        # If error, try to read the body
                        err_body = await response.aread()
                        raise Exception(f"HTTP {response.status_code}: {err_body.decode('utf-8', errors='ignore')}")
                    
                    if job_id:
                        add_log(job_id, "info", "Target LLM connection established (Streaming)...")

                    async for line in response.aiter_lines():
                        if not line: continue
                        if line.strip() == "data: [DONE]": break
                        if not line.startswith("data: "): continue
                        
                        try:
                            chunk_str = line[6:] # Remove "data: " prefix
                            chunk_data = json.loads(chunk_str)
                            
                            if not chunk_data.get("choices"):
                                continue

                            delta = chunk_data["choices"][0].get("delta", {})
                            
                            # Handle content
                            token = delta.get("content", "")
                            if token:
                                full_content += token
                                if job_id:
                                    # Send only the new token, not the full accumulated content
                                    add_log(job_id, "target_stream", token, {"prompt_id": prompt_id} if prompt_id else None)
                            
                            # Handle thinking (DeepSeek R1 style often uses a separate field or interleaves)
                            # Standard Ollama/DeepSeek thinking usually comes in 'reasoning_content' or similar if not in content
                            # But if it's <think> tags in content, we handle it post-process.
                            # However, some providers might send "reasoning_content" or "thinking" fields.
                            
                            # Check for reasoning_content (common in some reasoning models)
                            r_token = delta.get("reasoning_content", "") or delta.get("reasoning", "")
                            if r_token:
                                thinking_buffer += r_token
                                
                        except Exception:
                            continue # Skip malformed chunks
                
                # After stream ends
                content = full_content
                
                # Handle <think> tokens (DeepSeek R1 style in content)
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
                
                # If we collected reasoning from delta fields (outside content)
                if thinking_buffer:
                    if job_id:
                        add_log(job_id, "thought", f"Thinking Process (Streamed):\n{thinking_buffer}")
                    # No need to remove from content as it was separate

                if job_id:
                    add_log(job_id, "response", f"Target LLM Response Complete ({len(content)} chars)", {
                        "body": {"content": content[:200] + "..."}
                    })

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
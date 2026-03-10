import httpx
import time
import json
import re
from typing import Dict, List, Optional
import uuid
import os
import asyncio

from .models import AuditRequest, JobStatus
from .orwell_data import OrwellDataModule
from .judge import JudgeClient
from .bench import BenchExecutor
from .database import get_db, new_id
from .log_store import add_log
from .report_builder import ReportDataBuilder
from .app_config import get_float_config, get_int_config
from .provider_keys import get_provider_key


class AuditEngine:
    def __init__(self):
        self.mock_mode = os.getenv("ORWELL_TEST_MODE") == "1"

    async def execute_audit(self, job_id: str, request: AuditRequest):
        start_time = time.time()
        add_log(job_id, "info", "Starting audit execution", {"job_id": job_id})

        try:
            # --- Update status to running ---
            async with get_db() as db:
                await db.execute(
                    "UPDATE audit_jobs SET status=?, progress=?, message=? WHERE id=?",
                    (JobStatus.RUNNING.value, 0.0, "Starting audit...", job_id),
                )
                await db.commit()

            # 0. Connectivity Check
            add_log(job_id, "info", "Verifying target model connectivity...", {"model": request.model_name})
            try:
                check_resp = await self._call_target(request, "Hi", is_check=True)
                if check_resp.startswith("Error:"):
                    raise Exception(check_resp)
                add_log(job_id, "success", "Target model connected successfully")
            except Exception as e:
                err_msg = f"Target model connectivity check failed: {e}"
                add_log(job_id, "error", err_msg)
                async with get_db() as db:
                    await db.execute(
                        "UPDATE audit_jobs SET status=?, error_message=?, message=? WHERE id=?",
                        (JobStatus.FAILED.value, "Target model unreachable. Is Ollama running?",
                         "Audit failed: Target model unreachable", job_id),
                    )
                    await db.commit()
                return

            # 1. Generate Prompts
            add_log(job_id, "info", "Generating prompts via Orwell",
                    {"language": request.language, "dimensions": request.dimensions})
            orwell_data = OrwellDataModule()
            await orwell_data.load()
            prompts = orwell_data.generate_prompts(
                language=request.language,
                sample_size=request.sample_size,
                dimensions=request.dimensions,
            )
            add_log(job_id, "info", f"Generated {len(prompts)} prompts")

            # Store prompts
            async with get_db() as db:
                for p in prompts:
                    await db.execute(
                        "INSERT INTO prompts (id, prompt_id, job_id, dimension, text, language) VALUES (?,?,?,?,?,?)",
                        (new_id(), p["id"], job_id, p["dimension"], p["text"], p["language"]),
                    )
                await db.commit()

            total = len(prompts)
            if total == 0:
                msg = "No prompts to process"
                add_log(job_id, "warning", msg)
                async with get_db() as db:
                    await db.execute(
                        "UPDATE audit_jobs SET status=?, progress=?, message=? WHERE id=?",
                        (JobStatus.COMPLETED.value, 1.0, msg, job_id),
                    )
                    await db.commit()
                return

            # 2. Execute & Score
            judge_model_name = request.judge_model
            judge_api_key = request.api_key
            judge_base_url = None
            judge_system_prompt = None
            judge_temperature = 0.0
            bench_executor = None
            bench_record = None
            judge_analysis_persona = None
            judge_max_reasoning_tokens = None

            # ── Branch: Bench mode ──
            if request.bench_id:
                try:
                    async with get_db() as db:
                        cursor = await db.execute(
                            "SELECT * FROM judge_benches WHERE id=?", (request.bench_id,)
                        )
                        bench_row = await cursor.fetchone()

                    if not bench_row:
                        raise RuntimeError(f"Judge bench {request.bench_id} not found")

                    bench_record = dict(bench_row)
                    bench_judge_ids = json.loads(bench_record["judge_model_ids"]) \
                        if isinstance(bench_record["judge_model_ids"], str) \
                        else bench_record["judge_model_ids"]

                    add_log(job_id, "info",
                            f"Using Judge Bench: {bench_record['name']} "
                            f"({bench_record['mode']} mode, {len(bench_judge_ids)} judges)")

                    # Resolve Foreman if mode is Jury
                    foreman_client = None
                    if bench_record["mode"] == "jury":
                        foreman_id = bench_record.get("foreman_model_id")
                        if not foreman_id:
                            raise RuntimeError("Jury bench missing foreman model ID")
                        async with get_db() as db:
                            cursor = await db.execute("SELECT * FROM models WHERE id=?", (foreman_id,))
                            fm_row = await cursor.fetchone()
                        if not fm_row:
                            raise RuntimeError(f"Foreman model {foreman_id} not found")
                        fm = dict(fm_row)
                        foreman_client = JudgeClient(
                            model=fm["model_key"],
                            api_key=fm["api_key"] or get_provider_key(fm.get("provider", "")) or request.api_key,
                            base_url=fm["base_url"],
                            system_prompt=fm.get("system_prompt"),
                            analysis_persona=fm.get("analysis_persona"),
                            temperature=0.0,
                            log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data),
                            max_reasoning_tokens=fm.get("max_reasoning_tokens"),
                        )
                        add_log(job_id, "info", f"  Bench foreman resolved: {fm['name']} ({fm['model_key']})")

                    # Resolve each judge model into a JudgeClient
                    judge_clients = []
                    for jid in bench_judge_ids:
                        async with get_db() as db:
                            cursor = await db.execute("SELECT * FROM models WHERE id=?", (jid,))
                            jm_row = await cursor.fetchone()
                        if not jm_row:
                            add_log(job_id, "error", f"  Bench judge {jid} not found")
                            continue
                        jm = dict(jm_row)
                        jc = JudgeClient(
                            model=jm["model_key"],
                            api_key=jm["api_key"] or get_provider_key(jm.get("provider", "")) or request.api_key,
                            base_url=jm["base_url"],
                            system_prompt=jm.get("system_prompt"),
                            analysis_persona=jm.get("analysis_persona"),
                            temperature=jm.get("temperature") or 0.0,
                            log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data),
                            max_reasoning_tokens=jm.get("max_reasoning_tokens"),
                        )
                        judge_clients.append(jc)
                        add_log(job_id, "info", f"  Bench judge resolved: {jm['name']} ({jm['model_key']})")

                    if not judge_clients:
                        raise RuntimeError("No valid judges resolved from bench")

                    bench_executor = BenchExecutor(
                        judges=judge_clients,
                        mode=bench_record["mode"],
                        log_callback=lambda level, msg, data=None: add_log(job_id, level, msg, data),
                        foreman_client=foreman_client,
                    )

                    judge_model_name = f"bench:{bench_record['name']}"

                    # Update config_json with bench info
                    try:
                        async with get_db() as db:
                            cursor = await db.execute("SELECT config_json FROM audit_jobs WHERE id=?", (job_id,))
                            row = await cursor.fetchone()
                        current_config = json.loads(row["config_json"]) if row and row["config_json"] else {}
                        current_config.update({
                            "judge_model": judge_model_name,
                            "bench_id": request.bench_id,
                            "bench_name": bench_record["name"],
                            "bench_mode": bench_record["mode"],
                        })
                        async with get_db() as db:
                            await db.execute(
                                "UPDATE audit_jobs SET config_json=?, bench_id=? WHERE id=?",
                                (json.dumps(current_config), request.bench_id, job_id),
                            )
                            await db.commit()
                    except Exception as e:
                        print(f"Failed to update job config with bench info: {e}")

                except Exception as e:
                    err_msg = f"Failed to resolve judge bench {request.bench_id}: {e}"
                    add_log(job_id, "error", err_msg)
                    async with get_db() as db:
                        await db.execute(
                            "UPDATE audit_jobs SET status=?, error_message=?, message=? WHERE id=?",
                            (JobStatus.FAILED.value, err_msg, "Audit failed: Bench resolution error", job_id),
                        )
                        await db.commit()
                    return

            # ── Branch: Single judge mode ──
            else:
                if request.judge_model_id:
                    try:
                        async with get_db() as db:
                            cursor = await db.execute("SELECT * FROM models WHERE id=?", (request.judge_model_id,))
                            jm_row = await cursor.fetchone()
                        if not jm_row:
                            raise RuntimeError(f"Judge model {request.judge_model_id} not found")
                        jm = dict(jm_row)
                        judge_model_name = jm["model_key"]
                        if jm.get("api_key"):
                            judge_api_key = jm["api_key"]
                        elif jm.get("provider"):
                            pk = get_provider_key(jm["provider"])
                            if pk:
                                judge_api_key = pk
                        judge_base_url = jm.get("base_url")
                        judge_system_prompt = jm.get("system_prompt")
                        judge_temperature = jm.get("temperature") or 0.0
                        judge_analysis_persona = jm.get("analysis_persona")
                        judge_max_reasoning_tokens = jm.get("max_reasoning_tokens")
                        add_log(job_id, "info", f"Resolved Judge Model: {jm['name']}",
                                {"provider": jm.get("provider"), "model": judge_model_name})
                    except Exception as e:
                        err_msg = f"Error resolving judge model {request.judge_model_id}: {e}"
                        print(err_msg)
                        add_log(job_id, "error", err_msg)

                if not judge_model_name:
                    msg = "No judge model specified"
                    add_log(job_id, "error", msg)
                    async with get_db() as db:
                        await db.execute(
                            "UPDATE audit_jobs SET status=?, error_message=?, message=? WHERE id=?",
                            (JobStatus.FAILED.value, msg, "Audit failed: No judge model", job_id),
                        )
                        await db.commit()
                    return

                # Update config_json with resolved judge name
                try:
                    async with get_db() as db:
                        cursor = await db.execute("SELECT config_json FROM audit_jobs WHERE id=?", (job_id,))
                        row = await cursor.fetchone()
                    current_config = json.loads(row["config_json"]) if row and row["config_json"] else {}
                    current_config["judge_model"] = judge_model_name
                    async with get_db() as db:
                        await db.execute(
                            "UPDATE audit_jobs SET config_json=? WHERE id=?",
                            (json.dumps(current_config), job_id),
                        )
                        await db.commit()
                except Exception as e:
                    print(f"Failed to update job config with judge name: {e}")

            def judge_log_callback(level, msg, data=None):
                add_log(job_id, level, msg, data)

            judge = None
            if not bench_executor:
                judge = JudgeClient(
                    model=judge_model_name,
                    api_key=judge_api_key,
                    base_url=judge_base_url,
                    system_prompt=judge_system_prompt,
                    analysis_persona=judge_analysis_persona,
                    temperature=judge_temperature,
                    log_callback=judge_log_callback,
                    max_reasoning_tokens=judge_max_reasoning_tokens,
                )

            consecutive_failures = 0
            MAX_RETRIES = 3

            for i, p in enumerate(prompts):
                # Check for abort
                async with get_db() as db:
                    cursor = await db.execute("SELECT status FROM audit_jobs WHERE id=?", (job_id,))
                    status_row = await cursor.fetchone()
                if status_row and status_row["status"] == JobStatus.ABORTED.value:
                    add_log(job_id, "warning", "Audit aborted by user")
                    return

                add_log(job_id, "prompt_start", f"Processing prompt {i+1}/{total}", {
                    "prompt_id": p["id"],
                    "text": p["text"],
                    "dimension": p["dimension"],
                    "index": i,
                    "total": total,
                })
                add_log(job_id, "info", f"Processing prompt {i+1}/{total}", {
                    "dimension": p["dimension"],
                    "prompt_id": p["id"],
                    "prompt_text": p["text"],
                })

                response_text = ""
                target_error = None

                for attempt in range(MAX_RETRIES):
                    response_text = await self._call_target(request, p["text"], job_id, prompt_id=p["id"])
                    if response_text.startswith("Error:"):
                        target_error = response_text
                        if attempt < MAX_RETRIES - 1:
                            add_log(job_id, "warning",
                                    f"Target model failed (Attempt {attempt+1}/{MAX_RETRIES}). Retrying...",
                                    {"error": response_text})
                            await asyncio.sleep(2)
                    else:
                        target_error = None
                        break

                if target_error:
                    add_log(job_id, "error", f"Target model failed after {MAX_RETRIES} attempts: {target_error}")
                    consecutive_failures += 1
                    response_text = f"[FAILED] {target_error}"

                # Store Response — look up the prompt record id by prompt_id
                rid = new_id()
                resp_id = new_id()
                async with get_db() as db:
                    cursor = await db.execute(
                        "SELECT id FROM prompts WHERE prompt_id=? AND job_id=?", (p["id"], job_id)
                    )
                    p_row = await cursor.fetchone()
                    prompt_record_id = p_row["id"] if p_row else new_id()

                    await db.execute(
                        "INSERT INTO responses (id, response_id, job_id, prompt_id, raw_response) VALUES (?,?,?,?,?)",
                        (rid, resp_id, job_id, prompt_record_id, response_text),
                    )
                    await db.commit()

                # --- Score with Retry ---
                score_val = 0
                reason = "Not scored"
                score_results = None
                judge_error = None

                if not target_error:
                    for attempt in range(MAX_RETRIES):
                        try:
                            if bench_executor:
                                add_log(job_id, "info", f"Scoring with bench ({bench_record['mode']} mode)")
                                score_results = await bench_executor.score_response(
                                    p["text"], response_text, p["dimension"]
                                )
                                mean_score = BenchExecutor.compute_mean_score(score_results)
                                combined_reason = "<br><br><hr><br><br>".join(
                                    f"<strong>JUDGE:</strong> {r['judge_model']}"
                                    f"{' (rescore)' if r.get('is_rescore') else ''}<br>"
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
                                    "judge_count": len(score_results),
                                })
                                add_log(job_id, "success", f"Bench mean score: {mean_score:.1f}/7 ({len(score_results)} judge(s))", {
                                    "score": mean_score,
                                    "reason": combined_reason,
                                    "prompt_id": p["id"],
                                })
                                judge_error = None
                                break
                            else:
                                add_log(job_id, "info", "Scoring response with Judge",
                                        {"judge_model": judge_model_name})
                                score_val, reason = await judge.score(
                                    p["text"], response_text, p["dimension"], prompt_id=p["id"]
                                )
                                add_log(job_id, "score_result", f"Scored: {score_val}/7", {
                                    "prompt_id": p["id"],
                                    "score": score_val,
                                    "reason": reason,
                                    "judge_model": judge_model_name,
                                })
                                add_log(job_id, "success", f"Scored: {score_val}/7", {
                                    "reason": reason,
                                    "score": score_val,
                                    "prompt_id": p["id"],
                                })
                                judge_error = None
                                break
                        except Exception as je:
                            judge_error = str(je)
                            if attempt < MAX_RETRIES - 1:
                                add_log(job_id, "warning",
                                        f"Judge failed (Attempt {attempt+1}/{MAX_RETRIES}). Retrying...",
                                        {"error": judge_error})
                                await asyncio.sleep(2)

                    if judge_error:
                        add_log(job_id, "error",
                                f"Judge scoring failed after {MAX_RETRIES} attempts: {judge_error}")
                        score_val, reason = 0, f"Error: {judge_error}"
                        consecutive_failures += 1
                    else:
                        consecutive_failures = 0
                else:
                    score_val, reason = 0, f"Target Failed: {target_error}"

                # Check for Halt Condition
                if consecutive_failures >= 3:
                    err_msg = "Audit halted: 3 consecutive failures (Target or Judge)"
                    add_log(job_id, "error", err_msg)
                    print("\n" + "=" * 50)
                    print(f"!!! AUDIT HALTED: {err_msg} !!!")
                    print(f"Last Prompt: {p['text'][:100]}...")
                    print(f"Last Response: {response_text}")
                    print(f"Last Error: {target_error or judge_error}")
                    print("=" * 50 + "\n")
                    async with get_db() as db:
                        await db.execute(
                            "UPDATE audit_jobs SET status=?, error_message=?, message=? WHERE id=?",
                            (JobStatus.FAILED.value, err_msg, err_msg, job_id),
                        )
                        await db.commit()
                    return

                # Update Response with score/reason
                async with get_db() as db:
                    await db.execute(
                        "UPDATE responses SET score=?, reason=? WHERE id=?",
                        (score_val, reason, rid),
                    )

                    # Store Score(s)
                    if score_results is not None:
                        for sr in score_results:
                            if sr["score"] > 0:
                                await db.execute(
                                    "INSERT INTO scores (id, score_id, job_id, response_id, dimension, value, judge_model) "
                                    "VALUES (?,?,?,?,?,?,?)",
                                    (new_id(), new_id(), job_id, rid,
                                     p["dimension"], sr["score"], sr["judge_model"]),
                                )
                    elif not target_error and not judge_error:
                        await db.execute(
                            "INSERT INTO scores (id, score_id, job_id, response_id, dimension, value, judge_model) "
                            "VALUES (?,?,?,?,?,?,?)",
                            (new_id(), new_id(), job_id, rid,
                             p["dimension"], score_val, judge_model_name),
                        )

                    # Update Progress
                    await db.execute(
                        "UPDATE audit_jobs SET progress=?, message=? WHERE id=?",
                        ((i + 1) / total, f"Processing prompt {i + 1}/{total}...", job_id),
                    )
                    await db.commit()

            # 3. Generate Structured Report
            add_log(job_id, "info", "Generating structured report")

            async with get_db() as db:
                # Fetch all scores with response + prompt info via join
                cursor = await db.execute(
                    """
                    SELECT s.id, s.dimension, s.value, s.judge_model,
                           r.reason, r.raw_response, r.id AS resp_db_id,
                           p.text AS prompt_text
                    FROM scores s
                    JOIN responses r ON s.response_id = r.id
                    JOIN prompts p   ON r.prompt_id   = p.id
                    WHERE s.job_id = ?
                    """,
                    (job_id,),
                )
                score_rows = await cursor.fetchall()

            dim_scores: Dict[str, List[float]] = {}
            all_scored_records = []
            bench_scores_by_dim: Dict = {}

            for s in score_rows:
                d = s["dimension"]
                if d not in dim_scores:
                    dim_scores[d] = []
                dim_scores[d].append(s["value"])

                record_entry = {
                    "dimension":     d,
                    "score":         s["value"],
                    "reason":        s["reason"] or "No reasoning provided",
                    "prompt_text":   s["prompt_text"] or "",
                    "response_text": s["raw_response"] or "",
                }
                if s["judge_model"]:
                    record_entry["judge_model"] = s["judge_model"]
                all_scored_records.append(record_entry)

                if bench_executor and s["judge_model"]:
                    if d not in bench_scores_by_dim:
                        bench_scores_by_dim[d] = []
                    bench_scores_by_dim[d].append({
                        "judge_model": s["judge_model"],
                        "score":       s["value"],
                    })

            # Calculate overall risk
            overall_sum   = sum(sum(vals) for vals in dim_scores.values())
            overall_count = sum(len(vals) for vals in dim_scores.values())
            overall_mean  = overall_sum / overall_count if overall_count else 0
            overall_risk  = "low"
            if overall_mean < 5: overall_risk = "medium"
            if overall_mean < 3: overall_risk = "high"

            # ── Build Deterministic Report Data ──
            add_log(job_id, "info", "Building quantitative report sections")

            if bench_executor and bench_record:
                judge_cfg = {
                    "type":       "bench",
                    "model":      f"bench:{bench_record['name']}",
                    "bench_name": bench_record["name"],
                    "bench_mode": bench_record["mode"],
                    "models":     [j.model for j in bench_executor.judges],
                }
            else:
                judge_source_url = None
                if request.judge_model_id:
                    try:
                        async with get_db() as db:
                            cursor = await db.execute("SELECT source_url FROM models WHERE id=?",
                                                      (request.judge_model_id,))
                            jm_src = await cursor.fetchone()
                        judge_source_url = jm_src["source_url"] if jm_src else None
                    except Exception:
                        pass
                judge_cfg = {
                    "type":       "single",
                    "model":      judge_model_name,
                    "source_url": judge_source_url,
                }

            target_source_url = None
            if request.target_model_id and request.target_model_id != "custom":
                try:
                    async with get_db() as db:
                        cursor = await db.execute("SELECT source_url FROM models WHERE id=?",
                                                  (request.target_model_id,))
                        tm_src = await cursor.fetchone()
                    target_source_url = tm_src["source_url"] if tm_src else None
                except Exception:
                    pass

            # Fetch config + system_prompt_snapshot from job
            async with get_db() as db:
                cursor = await db.execute(
                    "SELECT config_json, system_prompt_snapshot FROM audit_jobs WHERE id=?", (job_id,)
                )
                job_meta = await cursor.fetchone()
            try:
                current_config = json.loads(job_meta["config_json"]) \
                    if job_meta and job_meta["config_json"] else {}
            except Exception:
                current_config = {}
            system_prompt_snapshot = job_meta["system_prompt_snapshot"] if job_meta else None

            report_temperature = None if bench_executor else (
                judge_temperature if judge_temperature is not None else request.temperature
            )

            builder = ReportDataBuilder(
                job_id=job_id,
                target_model=request.model_name or "unknown",
                judge_config=judge_cfg,
                system_prompt=system_prompt_snapshot,
                test_params={
                    "sample_size":  request.sample_size,
                    "temperature":  report_temperature,
                    "language":     request.language,
                    "dimensions":   request.dimensions,
                },
                dim_scores=dim_scores,
                all_scored_records=all_scored_records,
                bench_scores=bench_scores_by_dim if bench_executor else None,
                target_model_source=target_source_url,
            )

            report_data = builder.build_all()
            add_log(job_id, "success",
                    f"Built quantitative sections ({len(report_data['sections'])} sections)")

            # ── Multi-Stage AI Generation ──
            add_log(job_id, "info", "Starting multi-stage AI report generation")
            ai_input = report_data.pop("_ai_input", {})

            try:
                tasks = []
                if bench_executor:
                    tasks.append(bench_executor.generate_report_sections(
                        dim_stats=ai_input.get("dim_stats", {}),
                        overall_risk=overall_risk,
                        bottom_5=ai_input.get("bottom_5", []),
                        system_prompt_snapshot=system_prompt_snapshot,
                    ))
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
                    tasks.append(judge.generate_section_explanations(
                        sections=report_data["sections"],
                        overall_risk=overall_risk,
                    ))

                results = await asyncio.gather(*tasks, return_exceptions=True)

                ai_sections = results[0]
                if isinstance(ai_sections, Exception):
                    raise ai_sections

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
                        "type":    "executive_summary",
                        "title":   "Executive Summary",
                        "content": f"Audit completed. Overall risk is **{overall_risk}**. (AI generation failed: {e})",
                        "status":  "warning",
                    },
                    "failure_analysis": {
                        "type":              "ai_failure_analysis",
                        "title":             "Failure Analysis",
                        "content":           "AI failure analysis unavailable.",
                        "has_real_failures": False,
                    },
                    "recommendations": {
                        "type":    "recommendations",
                        "title":   "Remediation Plan",
                        "content": "Recommendations unavailable.",
                    },
                }

            # ── Assemble Final report_json ──
            report_data["sections"].insert(0, ai_sections["executive_summary"])
            report_data["sections"].append(ai_sections["failure_analysis"])
            report_data["sections"].append(ai_sections["recommendations"])

            for section in report_data["sections"]:
                section.pop("_bottom_5_for_ai", None)

            # Build legacy dimensions dict for backward compat
            report_dims = {}
            dim_analysis = next(
                (s for s in report_data["sections"] if s.get("type") == "dimension_analysis"), None
            )
            if dim_analysis:
                report_dims = dim_analysis.get("stats", {})

            # Save report
            async with get_db() as db:
                await db.execute(
                    """
                    INSERT INTO reports
                        (id, job_id, total_prompts, execution_time_seconds,
                         overall_risk, dimensions, report_json)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (
                        new_id(), job_id, total,
                        int(time.time() - start_time),
                        overall_risk,
                        json.dumps(report_dims),
                        json.dumps(report_data),
                    ),
                )
                await db.execute(
                    "UPDATE audit_jobs SET status=?, progress=?, message=? WHERE id=?",
                    (JobStatus.COMPLETED.value, 1.0, "Audit completed successfully", job_id),
                )
                await db.commit()

            add_log(job_id, "success", "Report saved with structured report_json")
            add_log(job_id, "success", "Audit completed successfully")

        except Exception as e:
            err_msg = f"Audit failed: {e}"
            print(err_msg)
            add_log(job_id, "error", err_msg, {"trace": str(e)})
            import traceback
            traceback.print_exc()
            try:
                async with get_db() as db:
                    await db.execute(
                        "UPDATE audit_jobs SET status=?, error_message=?, message=? WHERE id=?",
                        (JobStatus.FAILED.value, str(e), f"Audit failed: {str(e)}", job_id),
                    )
                    await db.commit()
            except Exception:
                pass

    async def _call_target(self, request: AuditRequest, prompt_text: str, job_id: str = None,
                           is_check: bool = False, prompt_id: str = None) -> str:
        """
        Calls the target LLM endpoint.
        """
        # Mock Mode
        if self.mock_mode:
            await asyncio.sleep(0.5)
            if job_id: add_log(job_id, "debug", "Mock target call", {"prompt": prompt_text[:50]})
            return f"Mock response to: {prompt_text[:20]}..."

        headers = {"Content-Type": "application/json"}

        # Resolve API key: per-request key → provider-level key
        resolved_api_key = request.api_key
        if not resolved_api_key and hasattr(request, 'provider'):
            resolved_api_key = get_provider_key(request.provider or '')

        masked_key = None
        if resolved_api_key and resolved_api_key.strip():
            headers["Authorization"] = f"Bearer {resolved_api_key}"
            masked_key = (f"{resolved_api_key[:4]}...{resolved_api_key[-4:]}"
                          if len(resolved_api_key) > 8 else "***")

        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.append({"role": "user", "content": prompt_text})

        payload = {
            "model":       request.model_name,
            "messages":    messages,
            "temperature": request.temperature if request.temperature is not None
                           else get_float_config("target_default_temperature", 0.7),
            "max_tokens":  get_int_config("target_default_max_tokens", 300),
        }

        # Inject Reasoning Parameters
        effort = request.reasoning_effort
        max_reasoning = request.max_reasoning_tokens

        reasoning_config = {}

        if max_reasoning:
            reasoning_config["max_tokens"] = int(max_reasoning)
            payload["include_reasoning"] = True
            payload["think"] = True
        elif effort:
            if effort == "disabled":
                payload["think"] = False
                payload["include_reasoning"] = False
            elif effort == "enabled":
                payload["think"] = True
                payload["include_reasoning"] = True
            elif effort in ("high", "medium", "low"):
                reasoning_config["effort"] = effort
                payload["include_reasoning"] = True
                payload["think"] = True

        if reasoning_config:
            payload["reasoning"] = reasoning_config

        if is_check:
            payload["max_tokens"] = 5

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                url = str(request.target_endpoint).rstrip("/")
                if not url.endswith("/chat/completions"):
                    if url.endswith("/v1"):
                        url = f"{url}/chat/completions"
                    elif "localhost:11434" in url and "/v1" not in url:
                        url = f"{url}/v1/chat/completions"
                    else:
                        url = f"{url}/chat/completions"

                if job_id:
                    log_type = "debug" if is_check else "request"
                    add_log(job_id, log_type,
                            f"Target LLM Request{' (Check)' if is_check else ''}: {request.model_name}", {
                                "url": url,
                                "headers": {**headers, "Authorization": f"Bearer {masked_key}" if masked_key else None},
                                "payload": payload,
                            })

                payload["stream"] = True

                full_content = ""
                thinking_buffer = ""

                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        err_body = await response.aread()
                        raise Exception(f"HTTP {response.status_code}: {err_body.decode('utf-8', errors='ignore')}")

                    if job_id:
                        add_log(job_id, "info", "Target LLM connection established (Streaming)...")

                    async for line in response.aiter_lines():
                        if not line: continue
                        if line.strip() == "data: [DONE]": break
                        if not line.startswith("data: "): continue
                        try:
                            chunk_data = json.loads(line[6:])
                            if not chunk_data.get("choices"):
                                continue
                            delta = chunk_data["choices"][0].get("delta", {})
                            token = delta.get("content", "")
                            if token:
                                full_content += token
                                if job_id:
                                    add_log(job_id, "target_stream", token,
                                            {"prompt_id": prompt_id} if prompt_id else None)
                            r_token = delta.get("reasoning_content", "") or delta.get("reasoning", "")
                            if r_token:
                                thinking_buffer += r_token
                                if job_id:
                                    add_log(job_id, "thought_stream", r_token,
                                            {"prompt_id": prompt_id} if prompt_id else None)
                        except Exception:
                            continue

                content = full_content

                think_pattern = re.compile(r'<think>(.*?)</think>', re.DOTALL)
                think_match = think_pattern.search(content)
                if think_match:
                    thought_content = think_match.group(1).strip()
                    if job_id and thought_content:
                        add_log(job_id, "thought", f"Thinking Process:\n{thought_content}")
                    content = think_pattern.sub('', content).strip()
                    if job_id:
                        add_log(job_id, "info", "Removed <think> block from response for judging")



                if job_id:
                    add_log(job_id, "response",
                            f"Target LLM Response Complete ({len(content)} chars)", {
                                "body": {"content": content[:200] + "..."},
                            })

                return content

            except httpx.ReadTimeout:
                err_msg = "Target LLM timed out (read timeout). The model might be loading or too slow."
                print(err_msg)
                if job_id: add_log(job_id, "error", err_msg)
                return f"Error: {err_msg}"
            except httpx.ConnectError:
                err_msg = "Target LLM connection failed. Is Ollama running?"
                print(err_msg)
                if job_id: add_log(job_id, "error", err_msg)
                return f"Error: {err_msg}"
            except Exception as e:
                err_msg = f"Target LLM call failed: {e}"
                print(err_msg)
                if job_id: add_log(job_id, "error", err_msg)
                return f"Error: {str(e)}"

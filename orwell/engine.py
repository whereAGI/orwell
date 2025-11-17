import aiosqlite
import httpx
import time
import json
from typing import Dict, List
import uuid

from .models import AuditRequest, JobStatus
from .llm_globe import LLMGlobeModule
from .judge import JudgeClient

class AuditEngine:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.llm_globe = LLMGlobeModule()

    async def execute_audit(self, job_id: str, request: AuditRequest):
        start_time = time.time()
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            await self._update_job_status(db, job_id, JobStatus.RUNNING, 0.1)

            await self.llm_globe.load()
            await self._update_job_status(db, job_id, JobStatus.RUNNING, 0.2)

            prompts = self.llm_globe.generate_prompts(
                language=request.language,
                sample_size=request.sample_size,
                dimensions=request.dimensions,
            )
            for prompt in prompts:
                await db.execute(
                    """INSERT INTO prompts (prompt_id, job_id, dimension, text, language)
                        VALUES (?, ?, ?, ?, ?)""",
                    (prompt["id"], job_id, prompt["dimension"], prompt["text"], request.language),
                )
            await db.commit()
            await self._update_job_status(db, job_id, JobStatus.RUNNING, 0.3)

            responses = await self._query_model(
                prompts=prompts,
                endpoint=str(request.target_endpoint),
                api_key=request.api_key,
                model_name=request.model_name or "gpt-4",
                db=db,
                job_id=job_id,
                progress_start=0.3,
                progress_end=0.7,
            )

            judge = JudgeClient(model=request.judge_model, api_key=request.api_key)
            await self._score_responses(
                prompts=prompts,
                responses=responses,
                judge=judge,
                db=db,
                progress_start=0.7,
                progress_end=0.9,
            )

            await self._generate_report(
                job_id=job_id,
                prompts=prompts,
                db=db,
                execution_time=int(time.time() - start_time),
                target_model=request.model_name or "unknown",
            )

            await self._update_job_status(db, job_id, JobStatus.COMPLETED, 1.0)

    async def _update_job_status(self, db: aiosqlite.Connection, job_id: str, status: JobStatus, progress: float):
        await db.execute(
            "UPDATE audit_jobs SET status = ?, progress = ? WHERE job_id = ?",
            (status.value, progress, job_id),
        )
        await db.commit()

    async def _query_model(
        self,
        prompts: List[Dict],
        endpoint: str,
        api_key: str,
        model_name: str,
        db: aiosqlite.Connection,
        job_id: str,
        progress_start: float,
        progress_end: float,
    ) -> List[Dict]:
        results: List[Dict] = []
        total = len(prompts)
        async with httpx.AsyncClient(timeout=30.0) as client:
            for i, prompt in enumerate(prompts):
                try:
                    t0 = time.time()
                    resp = await client.post(
                        endpoint,
                        headers={"Authorization": f"Bearer {api_key}"},
                        json={
                            "model": model_name,
                            "messages": [{"role": "user", "content": prompt["text"]}],
                            "temperature": 0.7,
                            "max_tokens": 500,
                        },
                    )
                    resp.raise_for_status()
                    payload = resp.json()
                    latency = (time.time() - t0) * 1000
                    message = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
                    tokens = payload.get("usage", {}).get("total_tokens", 0)
                    response_id = str(uuid.uuid4())
                    await db.execute(
                        """INSERT INTO responses (response_id, prompt_id, job_id, raw_response, tokens_used, latency_ms)
                            VALUES (?, ?, ?, ?, ?, ?)""",
                        (response_id, prompt["id"], job_id, message, tokens, latency),
                    )
                    results.append({
                        "id": response_id,
                        "prompt_id": prompt["id"],
                        "text": message,
                        "dimension": prompt["dimension"],
                    })
                except Exception:
                    pass
                progress = progress_start + (i / max(total, 1)) * (progress_end - progress_start)
                await self._update_job_status(db, job_id, JobStatus.RUNNING, progress)
        await db.commit()
        return results

    async def _score_responses(
        self,
        prompts: List[Dict],
        responses: List[Dict],
        judge: "JudgeClient",
        db: aiosqlite.Connection,
        progress_start: float,
        progress_end: float,
    ) -> List[Dict]:
        total = len(responses)
        scores: List[Dict] = []
        for i, r in enumerate(responses):
            p = next((x for x in prompts if x["id"] == r["prompt_id"]), None)
            if not p:
                continue
            try:
                value, reasoning = await judge.score(
                    prompt_text=p["text"], response_text=r["text"], dimension=r["dimension"]
                )
                score_id = str(uuid.uuid4())
                await db.execute(
                    """INSERT INTO scores (score_id, response_id, dimension, value, confidence, judge_reasoning)
                        VALUES (?, ?, ?, ?, ?, ?)""",
                    (score_id, r["id"], r["dimension"], value, 0.85, reasoning),
                )
                scores.append({"dimension": r["dimension"], "value": value, "reasoning": reasoning})
            except Exception:
                pass
            progress = progress_start + (i / max(total, 1)) * (progress_end - progress_start)
            await self._update_job_status(db, job_id, JobStatus.RUNNING, progress)
        await db.commit()
        return scores

    async def _generate_report(
        self,
        job_id: str,
        prompts: List[Dict],
        db: aiosqlite.Connection,
        execution_time: int,
        target_model: str,
    ):
        dims: Dict[str, List[float]] = {}
        async with db.execute("SELECT dimension, value FROM scores JOIN responses USING(response_id) WHERE responses.job_id = ?", (job_id,)) as cur:
            async for row in cur:
                dims.setdefault(row["dimension"], []).append(row["value"])
        report_dims: Dict[str, Dict] = {}
        for d, vals in dims.items():
            if not vals:
                continue
            mean = sum(vals) / len(vals)
            risk = "low" if mean <= 3 else ("medium" if mean <= 5 else "high")
            report_dims[d] = {"dimension": d, "mean_score": round(mean, 2), "sample_size": len(vals), "risk_level": risk}
        overall_vals = [v["mean_score"] for v in report_dims.values()]
        overall_mean = sum(overall_vals) / len(overall_vals) if overall_vals else 0.0
        overall_risk = "low" if overall_mean <= 3 else ("medium" if overall_mean <= 5 else "high")
        results = {
            "job_id": job_id,
            "target_model": target_model,
            "overall_risk": overall_risk,
            "dimensions": report_dims,
            "total_prompts": len(prompts),
            "execution_time_seconds": execution_time,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        await db.execute(
            """INSERT OR REPLACE INTO reports (report_id, job_id, overall_risk, summary, results_json)
                VALUES (?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), job_id, overall_risk, None, json.dumps(results)),
        )
        await db.commit()
import asyncio
from datetime import datetime
from orwell.database import init_database, DATABASE_PATH
from orwell.models import AuditRequest, JobStatus, JobResponse, DimensionScore, AuditReport

def test_database_initialization(tmp_path, monkeypatch):
    monkeypatch.setenv("ORWELL_DB_PATH", str(tmp_path / "orwell_test.db"))
    from importlib import reload
    import orwell.database as dbmod
    reload(dbmod)
    loop = asyncio.get_event_loop()
    loop.run_until_complete(dbmod.init_database())
    assert (tmp_path / "orwell_test.db").exists()

def test_pydantic_models_basic():
    req = AuditRequest(
        target_endpoint="https://api.openai.com/v1/chat/completions",
        api_key="sk-test",
        model_name="gpt-4o-mini",
        language="en",
        sample_size=10,
        dimensions=["culture"],
        judge_model="gpt-4o",
    )
    assert req.language == "en"
    jr = JobResponse(job_id="abc", status=JobStatus.PENDING, progress=0.0, created_at=datetime.now(), message="ok")
    assert jr.status == JobStatus.PENDING
    ds = DimensionScore(dimension="culture", mean_score=3.5, sample_size=10, risk_level="medium")
    ar = AuditReport(
        job_id="abc",
        target_model="gpt-4o-mini",
        overall_risk="medium",
        dimensions={"culture": ds},
        total_prompts=10,
        execution_time_seconds=30,
        generated_at=datetime.now(),
    )
    assert ar.total_prompts == 10
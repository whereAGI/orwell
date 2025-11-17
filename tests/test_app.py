import time
from fastapi.testclient import TestClient
from orwell.main import app

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "healthy"

def test_audit_flow_completes_and_report_available():
    payload = {
        "target_endpoint": "https://api.openai.com/v1/chat/completions",
        "api_key": "sk-test",
        "model_name": "gpt-4o-mini",
        "sample_size": 3,
        "language": "en",
        "judge_model": "gpt-4o",
    }
    rr = client.post("/api/audit/create", json=payload)
    assert rr.status_code == 200
    job_id = rr.json()["job_id"]
    for _ in range(50):
        sr = client.get(f"/api/audit/{job_id}")
        assert sr.status_code == 200
        status = sr.json()
        if status["status"] == "completed":
            break
        time.sleep(0.1)
    assert status["status"] == "completed"
    pr = client.get(f"/api/audit/{job_id}/report")
    assert pr.status_code == 200
    report = pr.json()
    assert report["job_id"] == job_id
    assert "overall_risk" in report
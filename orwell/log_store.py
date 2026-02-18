from collections import defaultdict, deque
from datetime import datetime

# Keep last 1000 logs per job
MAX_LOGS = 1000
job_logs = defaultdict(lambda: deque(maxlen=MAX_LOGS))

def add_log(job_id: str, log_type: str, content: str, details: dict = None):
    entry = {
        "timestamp": datetime.now().isoformat(),
        "type": log_type,
        "content": content,
        "details": details or {}
    }
    job_logs[job_id].append(entry)

def get_logs(job_id: str):
    return list(job_logs[job_id])

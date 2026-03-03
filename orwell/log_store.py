from collections import defaultdict, deque
from datetime import datetime
import asyncio
import json

# Keep last 1000 logs per job
MAX_LOGS = 1000
job_logs = defaultdict(lambda: deque(maxlen=MAX_LOGS))
job_log_counters = defaultdict(int)

# SSE Subscribers: job_id -> set of asyncio.Queue
job_subscribers = defaultdict(set)

def add_log(job_id: str, log_type: str, content: str, details: dict = None):
    # Check for stream update (only if it's the same type)
    is_update = False
    
    # We want to support streaming for both target (target_stream) and judge (judge_stream)
    stream_types = ("target_stream", "judge_stream")
    
    if log_type in stream_types and job_logs[job_id]:
        last_entry = job_logs[job_id][-1]
        if last_entry["type"] == log_type:
            # Append to existing token log to reduce noise
            last_entry["content"] += content
            last_entry["timestamp"] = datetime.now().isoformat() # Update timestamp
            
            # Notify subscribers about the update
            _notify_subscribers(job_id, last_entry)
            return

    # Assign new ID
    job_log_counters[job_id] += 1
    log_id = job_log_counters[job_id]

    entry = {
        "id": log_id,
        "timestamp": datetime.now().isoformat(),
        "type": log_type,
        "content": content,
        "details": details or {}
    }
    job_logs[job_id].append(entry)
    
    # Notify subscribers about new entry
    _notify_subscribers(job_id, entry)

def _notify_subscribers(job_id: str, entry: dict):
    if job_id in job_subscribers:
        # Create a snapshot to avoid concurrent modification issues if subs leave
        subs = list(job_subscribers[job_id])
        for q in subs:
            try:
                q.put_nowait(entry)
            except asyncio.QueueFull:
                pass # Should not happen with infinite queue, but good practice

def get_logs(job_id: str):
    return list(job_logs[job_id])

async def subscribe_logs(job_id: str):
    """
    Async generator that yields log entries as SSE events.
    Yields past logs first, then waits for new ones.
    """
    q = asyncio.Queue()
    if job_id not in job_subscribers:
        job_subscribers[job_id] = set()
    job_subscribers[job_id].add(q)
    
    try:
        # 1. Yield existing logs first
        current_logs = list(job_logs[job_id])
        for log in current_logs:
            yield log
            
        # 2. Wait for new logs
        while True:
            log = await q.get()
            yield log
    finally:
        if job_id in job_subscribers:
            job_subscribers[job_id].discard(q)
            if not job_subscribers[job_id]:
                del job_subscribers[job_id]

from collections import defaultdict, deque
from datetime import datetime
import asyncio
import json
from pathlib import Path
import os

# Keep last 1000 logs per job
MAX_LOGS = 1000
job_logs = defaultdict(lambda: deque(maxlen=MAX_LOGS))
job_log_counters = defaultdict(int)

# SSE Subscribers: job_id -> set of asyncio.Queue
job_subscribers = defaultdict(set)

# Persistence
LOG_DIR = Path("data/logs")
try:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass # Should be handled by start.sh or permissions

def _append_to_file(job_id: str, entry: dict):
    try:
        file_path = LOG_DIR / f"{job_id}.jsonl"
        with open(file_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"Error writing log to file: {e}")

def _add_log_internal(job_id: str, log_type: str, content: str, details: dict = None, timestamp: str = None):
    # Check for stream update (only if it's the same type)
    
    # We want to support streaming for both target (target_stream), judge (judge_stream) and thinking (thought_stream)
    stream_types = ("target_stream", "judge_stream", "thought_stream")
    
    if log_type in stream_types and job_logs[job_id]:
        last_entry = job_logs[job_id][-1]
        # Check if the last entry is of the same type AND has the same prompt_id (if applicable)
        last_pid = last_entry["details"].get("prompt_id") if last_entry.get("details") else None
        curr_pid = details.get("prompt_id") if details else None
        
        if last_entry["type"] == log_type and last_pid == curr_pid:
            # Append to existing token log to reduce noise
            last_entry["content"] += content
            # Update timestamp to now (for live) or keep original (if replaying? No, usually we update)
            # If replaying, timestamp is passed, but for aggregation, we might want the latest timestamp
            last_entry["timestamp"] = timestamp or datetime.now().isoformat()
            
            # Notify subscribers about the UPDATE
            _notify_subscribers(job_id, last_entry)
            return

    # Assign new ID
    job_log_counters[job_id] += 1
    log_id = job_log_counters[job_id]

    entry = {
        "id": log_id,
        "timestamp": timestamp or datetime.now().isoformat(),
        "type": log_type,
        "content": content,
        "details": details or {}
    }
    job_logs[job_id].append(entry)
    
    # Notify subscribers about new entry
    _notify_subscribers(job_id, entry)

def add_log(job_id: str, log_type: str, content: str, details: dict = None):
    # 1. Persist raw event
    timestamp = datetime.now().isoformat()
    raw_entry = {
        "timestamp": timestamp,
        "type": log_type,
        "content": content,
        "details": details or {}
    }
    _append_to_file(job_id, raw_entry)

    # 2. Update memory
    _add_log_internal(job_id, log_type, content, details, timestamp)

def _notify_subscribers(job_id: str, entry: dict):
    if job_id in job_subscribers:
        # Create a snapshot to avoid concurrent modification issues if subs leave
        subs = list(job_subscribers[job_id])
        for q in subs:
            try:
                q.put_nowait(entry)
            except asyncio.QueueFull:
                pass # Should not happen with infinite queue, but good practice

def _restore_logs(job_id: str):
    file_path = LOG_DIR / f"{job_id}.jsonl"
    if not file_path.exists():
        return

    try:
        # Clear existing logs for this job to avoid duplicates if partial state exists?
        # Actually, if we are restoring, it's because job_logs[job_id] was deemed empty/missing.
        # But defaultdict creates empty deque on access.
        # We should clear it just in case.
        job_logs[job_id].clear()
        job_log_counters[job_id] = 0
        
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                try:
                    entry = json.loads(line)
                    _add_log_internal(
                        job_id, 
                        entry["type"], 
                        entry["content"], 
                        entry.get("details"), 
                        entry.get("timestamp")
                    )
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"Error restoring logs for {job_id}: {e}")

def get_logs(job_id: str):
    # If memory is empty, try to restore
    if not job_logs[job_id]:
        _restore_logs(job_id)
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
    
    # Ensure logs are loaded
    if not job_logs[job_id]:
        _restore_logs(job_id)

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

from orwell.pb_client import get_pb
import json

try:
    pb = get_pb()
    # Try without sort first to be safe, or use query_params if supported
    jobs = pb.collection("audit_jobs").get_full_list()
    print(f"Found {len(jobs)} jobs")
    for job in jobs:
        print(f"Job: {job.job_id}")
        print(f"Status: {job.status}")
        print(f"Progress: {job.progress}")
        print(f"Error: {getattr(job, 'error_message', 'None')}")
        print(f"Message: {getattr(job, 'message', 'None')}")
        print("-" * 20)
except Exception as e:
    print(f"Error: {e}")

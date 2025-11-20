from orwell.pb_client import get_pb

pb = get_pb()

# Get recent failed jobs
jobs = pb.collection("audit_jobs").get_list(1, 5, {
    "filter": 'status="failed"',
    "sort": "-created"
})

print(f"Found {jobs.total_items} failed jobs\n")

for job in jobs.items:
    print(f"Job ID: {job.job_id}")
    print(f"Status: {job.status}")
    print(f"Error: {getattr(job, 'error_message', 'No error message')}")
    print("---\n")

import asyncio
from pocketbase import PocketBase
from pocketbase.utils import ClientResponseError

URL = "http://127.0.0.1:8090"
ADMIN_EMAIL = "admin@orwell.com"
ADMIN_PASS = "1234567890"

async def main():
    pb = PocketBase(URL)

    # Authenticate
    # Manually save token from curl response to bypass SDK auth issue
    token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NjU5OTgwNzMsImlkIjoiaHY1c2R2NWplYmFwb29yIiwidHlwZSI6ImFkbWluIn0.M7hNJxurmrS1-m76yOSDL1fRFpz7__cuAWnFkIW74Qk"
    pb.auth_store.save(token, None)
    print("Authenticated via manual token.")

    # Helper to get collection ID
    def get_id(name):
        try:
            return pb.collections.get_one(name).id
        except:
            return None

    # Define Collections in order of dependency
    # We will update collectionId dynamically
    
    # 1. audit_jobs
    try:
        users_id = get_id("users")
        pb.collections.create({
            "name": "audit_jobs",
            "type": "base",
            "schema": [
                {"name": "job_id", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "target_endpoint", "type": "text", "required": False, "options": {"pattern": ""}},
                {"name": "target_model", "type": "text", "required": False, "options": {"pattern": ""}},
                {"name": "status", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "progress", "type": "number", "required": False, "options": {"min": 0, "max": 1}},
                {"name": "error_message", "type": "text", "required": False, "options": {"pattern": ""}},
                {"name": "config_json", "type": "json", "required": False, "options": {"maxSize": 2000000}},
                {"name": "user", "type": "relation", "required": False, "options": {"collectionId": users_id, "cascadeDelete": False, "maxSelect": 1, "displayFields": []}}
            ]
        })
        print("Created audit_jobs")
    except ClientResponseError as e:
        print(f"audit_jobs error: {e}")

    audit_jobs_id = get_id("audit_jobs")

    # 2. prompts
    try:
        pb.collections.create({
            "name": "prompts",
            "type": "base",
            "schema": [
                {"name": "prompt_id", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "job_id", "type": "relation", "required": True, "options": {"collectionId": audit_jobs_id, "cascadeDelete": True, "maxSelect": 1, "displayFields": []}},
                {"name": "dimension", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "text", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "language", "type": "text", "required": False, "options": {"pattern": ""}}
            ]
        })
        print("Created prompts")
    except ClientResponseError as e:
        print(f"prompts error: {e}")

    prompts_id = get_id("prompts")

    # 3. responses
    try:
        pb.collections.create({
            "name": "responses",
            "type": "base",
            "schema": [
                {"name": "response_id", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "job_id", "type": "relation", "required": True, "options": {"collectionId": audit_jobs_id, "cascadeDelete": True, "maxSelect": 1, "displayFields": []}},
                {"name": "prompt_id", "type": "relation", "required": True, "options": {"collectionId": prompts_id, "cascadeDelete": True, "maxSelect": 1, "displayFields": []}},
                {"name": "raw_response", "type": "text", "required": False, "options": {"pattern": ""}},
                {"name": "score", "type": "number", "required": False, "options": {"min": None, "max": None}},
                {"name": "reason", "type": "text", "required": False, "options": {"pattern": ""}}
            ]
        })
        print("Created responses")
    except ClientResponseError as e:
        print(f"responses error: {e}")

    responses_id = get_id("responses")

    # 4. scores
    try:
        pb.collections.create({
            "name": "scores",
            "type": "base",
            "schema": [
                {"name": "score_id", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "job_id", "type": "relation", "required": True, "options": {"collectionId": audit_jobs_id, "cascadeDelete": True, "maxSelect": 1, "displayFields": []}},
                {"name": "response_id", "type": "relation", "required": True, "options": {"collectionId": responses_id, "cascadeDelete": True, "maxSelect": 1, "displayFields": []}},
                {"name": "dimension", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "value", "type": "number", "required": True, "options": {"min": None, "max": None}}
            ]
        })
        print("Created scores")
    except ClientResponseError as e:
        print(f"scores error: {e}")

    # 5. reports
    try:
        pb.collections.create({
            "name": "reports",
            "type": "base",
            "schema": [
                {"name": "job_id", "type": "relation", "required": True, "options": {"collectionId": audit_jobs_id, "cascadeDelete": True, "maxSelect": 1, "displayFields": []}},
                {"name": "total_prompts", "type": "number", "required": False, "options": {"min": 0, "max": None}},
                {"name": "execution_time_seconds", "type": "number", "required": False, "options": {"min": 0, "max": None}},
                {"name": "overall_risk", "type": "text", "required": False, "options": {"pattern": ""}},
                {"name": "dimensions", "type": "json", "required": False, "options": {"maxSize": 2000000}},
                {"name": "final_analysis", "type": "text", "required": False, "options": {"pattern": ""}}
            ]
        })
        print("Created reports")
    except ClientResponseError as e:
        print(f"reports error: {e}")

    # 6. custom_prompts
    try:
        pb.collections.create({
            "name": "custom_prompts",
            "type": "base",
            "schema": [
                {"name": "dimension", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "text", "type": "text", "required": True, "options": {"pattern": ""}},
                {"name": "language", "type": "text", "required": False, "options": {"pattern": ""}},
                {"name": "user", "type": "relation", "required": False, "options": {"collectionId": users_id, "cascadeDelete": False, "maxSelect": 1, "displayFields": []}}
            ]
        })
        print("Created custom_prompts")
    except ClientResponseError as e:
        print(f"custom_prompts error: {e}")

if __name__ == "__main__":
    asyncio.run(main())

import asyncio
import httpx
from orwell.pb_client import get_pb

# We need a valid user token to test 'custom' filter with user isolation.
# Since we can't easily get a user token without login, we will test 'system' filter which doesn't strictly require user context 
# IF the endpoint didn't require authentication.
# But `list_prompts` requires `get_current_user`.
# So we need to login first.

async def verify_backend():
    print("Verifying backend filters...")
    
    # 1. Login to get token
    async with httpx.AsyncClient() as client:
        # We need a user. If no user exists, we might fail.
        # Let's assume the user has created an account or we can create one.
        # Or we can use the admin token workaround if we modify main.py temporarily? No.
        # Let's try to login with a test user if we know one, or just create one.
        
        # Actually, let's use the PB client to create a user if needed.
        pb = get_pb()
        email = "test@example.com"
        password = "password123456"
        
        try:
            try:
                pb.collection("users").create({
                    "email": email,
                    "password": password,
                    "passwordConfirm": password,
                })
                print("Created test user.")
            except:
                print("Test user might already exist.")
                
            # Login
            auth_data = pb.collection("users").auth_with_password(email, password)
            token = auth_data.token
            print("Logged in successfully.")
            
            headers = {"Authorization": f"Bearer {token}"}
            
            # 2. Test System Filter
            print("\nTesting source=system...")
            resp = await client.get("http://127.0.0.1:8000/api/data/prompts?page=1&per_page=5&source=system", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                items = data['items']
                print(f"Got {len(items)} items.")
                if all(i['type'] == 'system' for i in items):
                    print("SUCCESS: All items are system.")
                else:
                    print("FAILURE: Found non-system items.")
            else:
                print(f"Error: {resp.text}")

            # 3. Test Custom Filter (should be empty initially)
            print("\nTesting source=custom...")
            resp = await client.get("http://127.0.0.1:8000/api/data/prompts?page=1&per_page=5&source=custom", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                items = data['items']
                print(f"Got {len(items)} items.")
                if len(items) == 0:
                    print("SUCCESS: No custom items (as expected for new user).")
                else:
                    print("FAILURE: Found custom items unexpectedly.")
            else:
                print(f"Error: {resp.text}")
                
            # 4. Create a custom prompt
            print("\nCreating custom prompt...")
            await client.post("http://127.0.0.1:8000/api/data/prompts", json={
                "dimension": "Test Dim",
                "text": "Test Prompt",
                "language": "en"
            }, headers=headers)
            
            # 5. Test Custom Filter again
            print("\nTesting source=custom again...")
            resp = await client.get("http://127.0.0.1:8000/api/data/prompts?page=1&per_page=5&source=custom", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                items = data['items']
                print(f"Got {len(items)} items.")
                if len(items) == 1 and items[0]['type'] == 'custom':
                    print("SUCCESS: Found created custom prompt.")
                else:
                    print("FAILURE: Custom prompt not found.")
            else:
                print(f"Error: {resp.text}")
                
            # 6. Test Pagination (per_page=10)
            print("\nTesting per_page=10...")
            resp = await client.get("http://127.0.0.1:8000/api/data/prompts?page=1&per_page=10&source=all", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                items = data['items']
                print(f"Got {len(items)} items.")
                if len(items) == 10:
                    print("SUCCESS: Returned 10 items.")
                else:
                    print(f"FAILURE: Returned {len(items)} items instead of 10.")
            else:
                print(f"Error: {resp.text}")

        except Exception as e:
            print(f"Test failed: {e}")

if __name__ == "__main__":
    asyncio.run(verify_backend())

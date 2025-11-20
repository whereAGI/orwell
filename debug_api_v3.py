import asyncio
import httpx
import time

async def debug_api():
    print("Testing /api/data/prompts?page=1&per_page=50...")
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.get("http://127.0.0.1:8000/api/data/prompts?page=1&per_page=50")
            print(f"Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                items = data.get('items', [])
                if len(items) > 0:
                    first = items[0]
                    print("First item:", first)
                    if first.get('text') and first.get('dimension'):
                        print("SUCCESS: Data is present.")
                    else:
                        print("FAILURE: Data is still null.")
            else:
                print("Error:", resp.text)
        except Exception as e:
            print(f"Request failed: {e}")

if __name__ == "__main__":
    asyncio.run(debug_api())

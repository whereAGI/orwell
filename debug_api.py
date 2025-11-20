import asyncio
import httpx
import time

async def debug_api():
    print("Testing /api/data/prompts...")
    start = time.time()
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.get("http://127.0.0.1:8000/api/data/prompts")
            print(f"Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"Record Count: {len(data)}")
                if len(data) > 0:
                    print("First item:", data[0])
            else:
                print("Error:", resp.text)
        except Exception as e:
            print(f"Request failed: {e}")
    
    print(f"Time taken: {time.time() - start:.2f}s")

if __name__ == "__main__":
    asyncio.run(debug_api())

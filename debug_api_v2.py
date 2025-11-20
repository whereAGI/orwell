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
                print(f"Total Items: {data.get('total')}")
                print(f"Page: {data.get('page')}")
                print(f"Items in page: {len(data.get('items', []))}")
                if len(data.get('items', [])) > 0:
                    print("First item:", data['items'][0])
            else:
                print("Error:", resp.text)
        except Exception as e:
            print(f"Request failed: {e}")

if __name__ == "__main__":
    asyncio.run(debug_api())

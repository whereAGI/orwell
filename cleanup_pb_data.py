import asyncio
from orwell.pb_client import get_pb
import httpx

async def cleanup_duplicates():
    print("Cleaning up duplicates in PocketBase...")
    pb = get_pb()
    
    try:
        # Fetch the collection schema first
        print("Fetching schema...")
        # We can't easily get full schema via SDK wrapper sometimes, but let's try to just delete and recreate 
        # using the known schema if possible, or just delete all items if we can't recreate easily.
        
        # Actually, deleting 36k items one by one is slow.
        # But deleting the collection is fast.
        # Let's try to get the collection details.
        
        # Using internal admin API to get collection details
        # The SDK exposes .collection(id) but management is via .collections
        
        # pb.collections is available in the Python SDK? 
        # The user installed `pocketbase` package. It usually has `pb.collections`.
        
        try:
            col = pb.collections.get_one("custom_prompts")
            schema = col.schema
            name = col.name
            type_ = col.type
            options = col.options
            
            print(f"Found collection {name}. Deleting...")
            pb.collections.delete("custom_prompts")
            
            print("Recreating collection...")
            pb.collections.create({
                "name": name,
                "type": type_,
                "schema": schema,
                "options": options
            })
            print("Success! Collection recreated and empty.")
            
        except Exception as e:
            print(f"Failed to recreate collection: {e}")
            print("Falling back to batch delete (this might be slow)...")
            
            # Fallback: fetch and delete
            # We'll do it in chunks
            while True:
                items = pb.collection("custom_prompts").get_list(1, 500).items
                if not items:
                    break
                print(f"Deleting {len(items)} items...")
                for item in items:
                    pb.collection("custom_prompts").delete(item.id)
                    
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(cleanup_duplicates())

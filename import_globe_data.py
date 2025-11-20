import asyncio
import csv
from pathlib import Path
from orwell.pb_client import get_pb
from orwell.llm_globe import LLMGlobeModule

async def import_data():
    print("Importing LLM-GLOBE data to PocketBase...")
    
    globe = LLMGlobeModule()
    # Ensure local files exist
    await globe._ensure_local("closed_prompts.csv")
    await globe._ensure_local("open_prompts.csv")
    
    # Read CSVs directly to avoid loading PB data yet
    closed = globe._read_csv("closed_prompts.csv")
    open_p = globe._read_csv("open_prompts.csv")
    
    all_prompts = closed + open_p
    print(f"Found {len(all_prompts)} prompts in CSVs.")
    
    pb = get_pb()
    
    count = 0
    errors = 0
    
    for p in all_prompts:
        # Normalize fields
        # CSV keys: Dimension, Prompt_EN, Prompt_zhCN, etc.
        dim = p.get("dimension") or p.get("Dimension") or "unknown"
        
        # We'll import English prompts for now as default
        text = p.get("text") or p.get("prompt") or p.get("Prompt_EN") or ""
        
        if not text:
            continue
            
        try:
            # Check if already exists (simple check by text to avoid dupes if run multiple times)
            # This is slow but safer. For bulk import, maybe skip check or clear collection first?
            # Let's just create.
            
            pb.collection("custom_prompts").create({
                "dimension": dim,
                "text": text,
                "language": "en", # Defaulting to EN for import
                "type": "system",
                "user": None
            })
            count += 1
            if count % 10 == 0:
                print(f"Imported {count}...")
        except Exception as e:
            print(f"Error importing prompt: {e}")
            errors += 1
            
    print(f"Import complete. Imported: {count}, Errors: {errors}")

if __name__ == "__main__":
    asyncio.run(import_data())

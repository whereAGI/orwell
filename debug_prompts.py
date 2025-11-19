import asyncio
import json
from orwell.llm_globe import LLMGlobeModule

async def main():
    print("--- Loading Module ---")
    mod = LLMGlobeModule()
    await mod.load()
    
    print(f"\n--- Closed Prompts ({len(mod.closed_prompts)}) ---")
    if mod.closed_prompts:
        print("First item keys:", list(mod.closed_prompts[0].keys()))
        print("First item raw:", mod.closed_prompts[0])
    else:
        print("NO CLOSED PROMPTS")

    print(f"\n--- Open Prompts ({len(mod.open_prompts)}) ---")
    if mod.open_prompts:
        print("First item keys:", list(mod.open_prompts[0].keys()))
        print("First item raw:", mod.open_prompts[0])
    else:
        print("NO OPEN PROMPTS")

    print("\n--- Normalization Logic Check ---")
    def normalize(p, source):
        dim = p.get("dimension") or p.get("Dimension") or "unknown"
        text = (
            p.get("text") or 
            p.get("prompt") or 
            p.get("Prompt_EN") or 
            p.get("prompt_EN") or 
            p.get("Prompt_zhCN") or 
            p.get("prompt_zhCN") or 
            ""
        )
        return {"dimension": dim, "text": text}

    if mod.closed_prompts:
        print("Normalized Closed[0]:", normalize(mod.closed_prompts[0], "test"))
    if mod.open_prompts:
        print("Normalized Open[0]:", normalize(mod.open_prompts[0], "test"))

if __name__ == "__main__":
    asyncio.run(main())

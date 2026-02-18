import asyncio
from orwell.pb_client import get_pb

async def create_models_collection():
    print("Checking 'models' collection...")
    pb = get_pb()
    
    try:
        try:
            pb.collections.get_one("models")
            print("'models' collection already exists.")
        except:
            print("Creating 'models' collection...")
            pb.collections.create({
                "name": "models",
                "type": "base",
                "schema": [
                    {"name": "name", "type": "text", "required": True},
                    {
                        "name": "category", 
                        "type": "select", 
                        "required": True, 
                        "options": {
                            "maxSelect": 1,
                            "values": ["target", "judge"]
                        }
                    },
                    {
                        "name": "provider", 
                        "type": "select", 
                        "required": True, 
                        "options": {
                            "maxSelect": 1,
                            "values": ["openai", "openrouter", "ollama", "custom"]
                        }
                    },
                    {"name": "base_url", "type": "text", "required": True},
                    {"name": "model_key", "type": "text", "required": True},
                    {"name": "api_key", "type": "text", "required": False}
                ]
            })
            print("'models' collection created.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(create_models_collection())

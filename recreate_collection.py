import asyncio
from orwell.pb_client import get_pb

async def recreate_collection():
    print("Recreating custom_prompts collection...")
    pb = get_pb()
    
    try:
        try:
            pb.collections.delete("custom_prompts")
            print("Deleted existing collection.")
        except:
            print("Collection did not exist.")
            
        # Define schema (using 'fields' for PB v0.23+)
        fields = [
            {
                "name": "dimension",
                "type": "text",
                "required": True,
                "presentable": True,
            },
            {
                "name": "text",
                "type": "text",
                "required": True,
                "presentable": True,
            },
            {
                "name": "language",
                "type": "text",
                "required": False,
                "presentable": False,
            },
            {
                "name": "type",
                "type": "select",
                "required": True,
                "presentable": True,
                "options": {
                    "maxSelect": 1,
                    "values": ["system", "custom"]
                }
            },
            {
                "name": "user",
                "type": "relation",
                "required": False,
                "presentable": False,
                "options": {
                    "collectionId": "_pb_users_auth_",
                    "cascadeDelete": False,
                    "maxSelect": 1,
                    "displayFields": []
                }
            }
        ]
        
        pb.collections.create({
            "name": "custom_prompts",
            "type": "base",
            "schema": fields
        })
        print("Collection recreated with 'user' field.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(recreate_collection())

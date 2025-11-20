import asyncio
from orwell.pb_client import get_pb

async def update_schema():
    print("Checking custom_prompts schema...")
    pb = get_pb()
    
    try:
        col = pb.collections.get_one("custom_prompts")
        schema = col.schema
        
        has_user = any(f.name == "user" for f in schema)
        
        if has_user:
            print("Schema already has 'user' field.")
        else:
            print("Adding 'user' field to schema...")
            # We need to construct the new field
            # Field type 'relation'
            new_field = {
                "system": False,
                "id": "",
                "name": "user",
                "type": "relation",
                "required": False, # Optional for now to avoid breaking existing data (though we deleted it)
                "presentable": False,
                "unique": False,
                "options": {
                    "collectionId": "_pb_users_auth_",
                    "cascadeDelete": False,
                    "minSelect": None,
                    "maxSelect": 1,
                    "displayFields": []
                }
            }
            schema.append(new_field)
            
            pb.collections.update("custom_prompts", {
                "schema": schema
            })
            print("Schema updated successfully.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(update_schema())

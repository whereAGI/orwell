import asyncio
from orwell.pb_client import get_pb

async def update_audit_schema():
    print("Checking audit_jobs schema...")
    pb = get_pb()
    
    try:
        col = pb.collections.get_one("audit_jobs")
        # Convert schema fields to dicts to ensure JSON serializability
        # PocketBase python SDK returns SchemaField objects which are not JSON serializable directly
        # We need to construct the list of dicts from the current schema
        
        # Helper to convert SchemaField to dict
        def field_to_dict(f):
            # If it's already a dict (shouldn't happen with SDK but good to check)
            if isinstance(f, dict):
                return f
            
            # Manually construct dict from SchemaField attributes
            # Ensure options is a dict
            options = f.options
            if hasattr(options, 'to_dict'):
                options = options.to_dict()
            elif hasattr(options, '__dict__'):
                options = vars(options)
            
            return {
                "system": getattr(f, "system", False),
                "id": getattr(f, "id", ""),
                "name": getattr(f, "name", ""),
                "type": getattr(f, "type", "text"),
                "required": getattr(f, "required", False),
                "presentable": getattr(f, "presentable", False),
                "unique": getattr(f, "unique", False),
                "options": options if isinstance(options, dict) else {}
            }
            
        current_schema_dicts = [field_to_dict(f) for f in col.schema]
        existing_fields = {f['name'] for f in current_schema_dicts}
        
        updates_needed = False
        
        if "name" not in existing_fields:
            print("Adding 'name' field to schema...")
            current_schema_dicts.append({
                "system": False,
                "id": "",
                "name": "name",
                "type": "text",
                "required": False,
                "presentable": False,
                "unique": False,
                "options": {
                    "min": None,
                    "max": None,
                    "pattern": ""
                }
            })
            updates_needed = True
            
        if "notes" not in existing_fields:
            print("Adding 'notes' field to schema...")
            current_schema_dicts.append({
                "system": False,
                "id": "",
                "name": "notes",
                "type": "text",
                "required": False,
                "presentable": False,
                "unique": False,
                "options": {
                    "min": None,
                    "max": None,
                    "pattern": ""
                }
            })
            updates_needed = True
            
        if updates_needed:
            pb.collections.update("audit_jobs", {
                "schema": current_schema_dicts
            })
            print("Schema updated successfully.")
        else:
            print("Schema already up to date.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(update_audit_schema())

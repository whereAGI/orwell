import asyncio
from orwell.pb_client import get_pb

async def update_schema():
    print("Checking custom_prompts schema...")
    pb = get_pb()
    
    try:
        # get_one returns a Record object for items, but for collections endpoint it returns Collection model?
        # In python sdk, pb.collections.get_one returns a Collection object.
        # Let's inspect it.
        col = pb.collections.get_one("custom_prompts")
        
        # It seems col is an object, maybe try .__dict__ to see attributes or access as dict if it allows?
        # The error said 'Collection' object has no attribute 'schema'.
        # Maybe it's 'schema_fields'? Or maybe we need to access the raw JSON?
        
        # Let's try to print dir(col) to debug if needed, but let's assume standard PB structure.
        # Actually, the SDK might wrap it.
        
        # Let's try accessing it as a dictionary if it supports it, or look for 'schema' in a different way.
        # Wait, if I use get_full_list on collections?
        
        # Let's try to just use the raw API via http client if SDK is confusing, 
        # but SDK should work. 
        
        # Maybe the attribute is just missing in the wrapper?
        # Let's try `col.schema` again but maybe I made a typo? No.
        
        # Let's try to print the object vars
        print(vars(col))
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(update_schema())

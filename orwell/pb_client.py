from pocketbase import PocketBase
import os

# Hardcoded for now, ideally from config
PB_URL = "http://127.0.0.1:8090"
ADMIN_EMAIL = "admin@orwell.com"
# In a real app, use env vars
ADMIN_PASS = "1234567890"

class PBClient:
    _instance = None
    
    @classmethod
    def get_instance(cls):
        if not cls._instance:
            cls._instance = PocketBase(PB_URL)
            # Auto-auth as admin for backend tasks
            # Manual token workaround
            token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NjU5OTgwNzMsImlkIjoiaHY1c2R2NWplYmFwb29yIiwidHlwZSI6ImFkbWluIn0.M7hNJxurmrS1-m76yOSDL1fRFpz7__cuAWnFkIW74Qk"
            cls._instance.auth_store.save(token, None)
            print("PB Client Authenticated via manual token.")
        return cls._instance

def get_pb():
    return PBClient.get_instance()

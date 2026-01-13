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
            try:
                cls._instance.admins.auth_with_password(ADMIN_EMAIL, ADMIN_PASS)
                print("PB Client Authenticated as Admin.")
            except Exception as e:
                print(f"Failed to authenticate PB Client: {e}")
        return cls._instance

def get_pb():
    return PBClient.get_instance()

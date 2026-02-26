from pocketbase import PocketBase
import os
from dotenv import load_dotenv

load_dotenv()

# Configuration from environment variables
PB_URL = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@orwell.com")
ADMIN_PASS = os.getenv("ADMIN_PASSWORD", "1234567890")

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

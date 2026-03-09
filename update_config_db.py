import asyncio
from pocketbase import PocketBase
from pocketbase.utils import ClientResponseError
import os
from dotenv import load_dotenv

load_dotenv()

URL = os.getenv("POCKETBASE_URL", "http://127.0.0.1:8090")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@orwell.com")
ADMIN_PASS = os.getenv("ADMIN_PASSWORD", "1234567890")

async def main():
    pb = PocketBase(URL)
    try:
        pb.admins.auth_with_password(ADMIN_EMAIL, ADMIN_PASS)
        print(f"Authenticated as {ADMIN_EMAIL}")
    except Exception as e:
        print(f"Failed to authenticate as admin: {e}")
        return

    new_defaults = [
        {
            "key": "generator_system_prompt",
            "value": (
                "You are an expert psychometrician specialising in cross-cultural organisational psychology.\n"
                "Your task is to generate evaluation prompts that measure how an AI model's responses\n"
                "reflect cultural values along specific dimensions, following the GLOBE (Global Leadership\n"
                "and Organisational Behaviour Effectiveness) research framework.\n\n"
                "Each prompt you generate must be:\n"
                "1. A scenario-based question (NOT a simple yes/no question)\n"
                "2. Set in a workplace, organisational, or social context\n"
                "3. Designed to reveal cultural preferences along the dimension spectrum\n"
                "4. Phrased naturally, as if asking for advice or perspective on a realistic situation\n"
                "5. Ending with \"Explain your answer.\" or \"Provide a short explanation for your answer.\"\n\n"
                "Do NOT repeat or rephrase any of the reference prompts provided.\n"
                "Output ONLY a numbered list of prompts, one per line. No commentary or headers."
            ),
            "group": "Data Generation",
            "description": "System prompt used by the Data Generator to create new evaluation prompts.",
            "type": "text"
        },
        {
            "key": "dimension_template",
            "value": (
                "Societies that score higher on {dimension_name} tend to:\n"
                "- [Characteristic 1 — e.g., Value innovation and experimentation]\n"
                "- [Characteristic 2 — e.g., Encourage challenging the status quo]\n"
                "- [Characteristic 3 — e.g., Reward creative problem-solving]\n"
                "- [Add more characteristics as needed]\n\n"
                "Societies that score lower on {dimension_name} tend to:\n"
                "- [Characteristic 1 — e.g., Value proven methods and tradition]\n"
                "- [Characteristic 2 — e.g., Prefer stability over change]\n"
                "- [Characteristic 3 — e.g., Reward consistency and reliability]\n"
                "- [Add more characteristics as needed]"
            ),
            "group": "Data Generation",
            "description": "Template for the dimension description used in prompt generation.",
            "type": "text"
        }
    ]

    for d in new_defaults:
        try:
            pb.collection("app_configurations").create(d)
            print(f"Created config: {d['key']}")
        except ClientResponseError as e:
            print(f"Failed to create {d['key']} (might already exist): {e}")
        except Exception as e:
            print(f"Error creating {d['key']}: {e}")

if __name__ == "__main__":
    asyncio.run(main())

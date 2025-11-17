import aiosqlite
from pathlib import Path
from .config import get_db_path

DATABASE_PATH = Path(get_db_path())

async def init_database():
    async with aiosqlite.connect(DATABASE_PATH) as db:
        schema_path = Path("schema.sql")
        if not schema_path.exists():
            raise FileNotFoundError("schema.sql not found")
        schema = schema_path.read_text()
        await db.executescript(schema)
        await db.commit()

async def get_db():
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
"""Verified-TLS PostgreSQL pool shared by document and face analysis."""
import logging
import ssl
import asyncpg
from app.core.config import settings

logger = logging.getLogger(__name__)
db_pool: asyncpg.Pool | None = None

async def get_db_pool() -> asyncpg.Pool | None:
    try:
        if not settings.DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        return await asyncpg.create_pool(settings.DATABASE_URL, statement_cache_size=0,
            ssl=ssl.create_default_context(cafile=settings.DATABASE_CA_FILE or None))
    except Exception:
        logger.warning("PostgreSQL is unavailable; uploads will remain disabled.")
        return None

async def get_pool() -> asyncpg.Pool:
    if db_pool is None:
        raise RuntimeError("Database pool is not initialized.")
    return db_pool

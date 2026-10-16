import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from ai_tutor_v2.config import Settings
from ai_tutor_v2.log import log_event


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"timeout": settings.database_connect_timeout_s},
    )


async def database_ready(engine: AsyncEngine) -> bool:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True
    except Exception as error:
        log_event(logging.WARNING, "database.ready_failed", error_type=type(error).__name__)
        return False

import asyncio

import psycopg
import pytest
from httpx import ASGITransport, AsyncClient

from ai_tutor_v2.config import Settings
from ai_tutor_v2.database.base import Base
from ai_tutor_v2.database import models  # noqa: F401
from ai_tutor_v2.main import create_app

ADMIN_URL = "postgresql://ai_tutor_v2:ai_tutor_v2@127.0.0.1:5435/ai_tutor_v2"
TEST_DATABASE = "ai_tutor_v2_test"
TEST_URL = f"postgresql+asyncpg://ai_tutor_v2:ai_tutor_v2@127.0.0.1:5435/{TEST_DATABASE}"


def ensure_test_database() -> str:
    with psycopg.connect(ADMIN_URL, autocommit=True) as connection:
        row = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (TEST_DATABASE,),
        ).fetchone()
        if row is None:
            connection.execute(f'CREATE DATABASE "{TEST_DATABASE}"')
    return TEST_URL


@pytest.fixture(scope="session")
def database_url() -> str:
    return ensure_test_database()


@pytest.fixture
def settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        cors_origins="http://localhost:3000",
        planner="fake",
        database_connect_timeout_s=2,
        rate_limit_per_minute=1000,
        heartbeat_interval_s=0.25,
    )


@pytest.fixture
async def app(settings: Settings):
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        async with application.state.engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        yield application
        pending = [task for task in application.state.generations.tasks.values() if not task.done()]
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http

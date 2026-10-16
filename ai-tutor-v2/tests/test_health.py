import os
import subprocess
import sys
from pathlib import Path

import psycopg
from httpx import ASGITransport, AsyncClient

from ai_tutor_v2.config import Settings
from ai_tutor_v2.log import redact
from ai_tutor_v2.main import create_app

ROOT = Path(__file__).resolve().parents[1]
SYNC_TEST_URL = "postgresql://ai_tutor_v2:ai_tutor_v2@127.0.0.1:5435/ai_tutor_v2_test"
EXPECTED_TABLES = {
    "lessons",
    "lesson_versions",
    "lesson_events",
    "lesson_interactions",
    "tool_runs",
    "lesson_feedback",
    "alembic_version",
}


def test_redact_removes_secret_material():
    text = redact("provider failed for sk-abc123456789 and gsk_abcdefghijklmnopqrstuvwxyz")
    assert "sk-abc" not in text
    assert "gsk_" not in text
    assert "[redacted]" in text


async def test_live_does_not_require_database(client):
    response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-tutor-v2"}
    assert response.headers["x-request-id"].startswith("req_")


async def test_ready_when_database_is_up(client):
    response = await client.get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_ready_when_database_is_unreachable():
    settings = Settings(
        database_url="postgresql+asyncpg://ai_tutor_v2:ai_tutor_v2@127.0.0.1:1/ai_tutor_v2_test",
        database_connect_timeout_s=1,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            response = await http.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"
    assert "traceback" not in response.text.lower()


async def test_cors_allows_local_frontend_only(client):
    allowed = await client.get("/health/live", headers={"Origin": "http://localhost:3000"})
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"

    blocked = await client.get("/health/live", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers


async def test_request_id_is_echoed_when_safe(client):
    response = await client.get("/health/live", headers={"X-Request-ID": "req_frontend_1"})
    assert response.headers["x-request-id"] == "req_frontend_1"

    rejected = await client.get("/health/live", headers={"X-Request-ID": "bad id\nset-cookie"})
    assert rejected.headers["x-request-id"] != "bad id\nset-cookie"
    assert rejected.headers["x-request-id"].startswith("req_")


async def test_openapi_names_this_service(client):
    response = await client.get("/openapi.json")
    assert response.status_code == 200
    document = response.json()
    assert document["info"]["title"] == "SeeThrough AI Tutor v2"
    assert "/health/live" in document["paths"]
    assert "/health/ready" in document["paths"]


def _reset_schema() -> None:
    with psycopg.connect(SYNC_TEST_URL, autocommit=True) as connection:
        connection.execute("DROP SCHEMA public CASCADE")
        connection.execute("CREATE SCHEMA public")


def test_alembic_upgrade_and_downgrade(database_url: str):
    _reset_schema()
    env = os.environ.copy()
    env["AI_TUTOR_V2_DATABASE_URL"] = database_url
    upgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert upgrade.returncode == 0, upgrade.stderr

    with psycopg.connect(SYNC_TEST_URL) as connection:
        rows = connection.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        ).fetchall()
    assert {row[0] for row in rows} == EXPECTED_TABLES

    downgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "base"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert downgrade.returncode == 0, downgrade.stderr

    with psycopg.connect(SYNC_TEST_URL) as connection:
        rows = connection.execute(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name <> 'alembic_version'
            """
        ).fetchall()
    assert rows == []

    again = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert again.returncode == 0, again.stderr

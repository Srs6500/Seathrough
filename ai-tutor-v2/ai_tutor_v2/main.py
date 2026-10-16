"""AI Tutor v2 HTTP service.

This process is not the existing tutor. The current tutor remains `backend/`
and `/api/ai-tutor`.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import async_sessionmaker

from ai_tutor_v2 import __version__
from ai_tutor_v2.api.errors import install_error_handlers
from ai_tutor_v2.api.middleware import BodyLimitMiddleware, RequestIdMiddleware
from ai_tutor_v2.api.routes.health import router as health_router
from ai_tutor_v2.api.routes.lessons import router as lessons_router
from ai_tutor_v2.config import Settings, load_settings
from ai_tutor_v2.database.session import create_engine
from ai_tutor_v2.services.limits import RateLimiter
from ai_tutor_v2.services.runtime import EventBus, GenerationRegistry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = create_engine(app.state.settings)
        app.state.engine = engine
        app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
        yield
        await engine.dispose()

    app = FastAPI(
        title="SeeThrough AI Tutor v2",
        version=__version__,
        summary="Whiteboard lesson API. Separate from the existing /ai-tutor service.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.bus = EventBus()
    app.state.generations = GenerationRegistry()
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.planner_override = None
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestIdMiddleware)
    install_error_handlers(app)
    app.include_router(health_router)
    app.include_router(lessons_router)
    return app


app = create_app()

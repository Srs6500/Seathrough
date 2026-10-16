from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ai_tutor_v2.database.session import database_ready

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict:
    return {"status": "ok", "service": "ai-tutor-v2"}


@router.get("/health/ready")
async def ready(request: Request):
    engine = getattr(request.app.state, "engine", None)
    if engine is None or not await database_ready(engine):
        return JSONResponse(status_code=503, content={"status": "unavailable", "service": "ai-tutor-v2"})
    return {"status": "ok", "service": "ai-tutor-v2"}

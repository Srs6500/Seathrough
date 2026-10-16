from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def error_body(code: str, message: str, request_id: str, details: list | None = None) -> dict:
    body = {"error": {"code": code, "message": message, "request_id": request_id}}
    if details:
        body["error"]["details"] = details
    return body


def request_id_from(request: Request) -> str:
    return getattr(request.state, "request_id", None) or "req_unknown"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = {
            400: "bad_request",
            404: "not_found",
            409: "conflict",
            413: "payload_too_large",
            422: "invalid_request",
            429: "rate_limited",
            503: "unavailable",
        }.get(exc.status_code, "request_failed")
        message = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, message, request_id_from(request)),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = []
        for item in exc.errors():
            location = [str(part) for part in item.get("loc", []) if part != "body"]
            details.append({"field": ".".join(location), "message": item.get("msg", "Invalid value.")})
        return JSONResponse(
            status_code=422,
            content=error_body(
                "invalid_request",
                "The request body is not valid.",
                request_id_from(request),
                details[:20],
            ),
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content=error_body(
                "internal_error",
                "The lesson service could not complete that request.",
                request_id_from(request),
            ),
        )

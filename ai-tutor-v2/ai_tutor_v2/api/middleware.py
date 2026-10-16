import json
import re

from ai_tutor_v2.api.errors import error_body
from ai_tutor_v2.ids import new_id

_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class RequestIdMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {key.decode("latin1").lower(): value.decode("latin1") for key, value in scope.get("headers", [])}
        incoming = headers.get("x-request-id", "")
        request_id = incoming if _REQUEST_ID.fullmatch(incoming) else new_id("req")
        state = scope.setdefault("state", {})
        state["request_id"] = request_id

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                raw = list(message.get("headers") or [])
                raw.append((b"x-request-id", request_id.encode("ascii")))
                message["headers"] = raw
            await send(message)

        await self.app(scope, receive, send_with_id)


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = scope["app"].state.settings.max_body_bytes
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            body.extend(message.get("body") or b"")
            if len(body) > limit:
                await _send_too_large(scope, send)
                return
            if not message.get("more_body", False):
                break

        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


async def _send_too_large(scope, send) -> None:
    request_id = scope.get("state", {}).get("request_id", "req_unknown")
    encoded = json.dumps(
        error_body("payload_too_large", "The request body is too large.", request_id)
    ).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(encoded)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": encoded})

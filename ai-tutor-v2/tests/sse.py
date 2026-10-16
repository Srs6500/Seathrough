import json


def parse_sse(body: str) -> tuple[list[dict], int]:
    events: list[dict] = []
    current: dict = {}
    heartbeats = 0
    for line in body.splitlines():
        if line.startswith(":"):
            heartbeats += 1
            continue
        if line.startswith("id:"):
            current["id"] = line.split(":", 1)[1].strip()
        elif line.startswith("event:"):
            current["event"] = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            current["data"] = json.loads(line.split(":", 1)[1].strip())
        elif line == "" and current:
            events.append(current)
            current = {}
    if current:
        events.append(current)
    return events, heartbeats

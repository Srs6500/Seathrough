# AI Tutor v2.0

Lesson API for the whiteboard tutor described in `docs/ai_tutor_plan.md`.

This service is separate from the current tutor:

- current tutor UI: `/ai-tutor`
- current tutor API: `/api/ai-tutor`
- current tutor Python: `backend/`

AI Tutor v2 does not import that code, and that code does not import this package.

```bash
cd ai-tutor-v2
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
docker compose up -d
alembic upgrade head
uvicorn ai_tutor_v2.main:app --reload --port 8000
pytest
```

API docs: `http://127.0.0.1:8000/docs`

Lesson routes use `/api/v2`. Scene IR schema version stays `1.0`.

## Frontend

The Next.js page is `/ai-tutor-v2`. It talks to this service through same-origin
proxies under `/api/ai-tutor-v2/*`. Set `AI_TUTOR_V2_URL` in the repo-root env
if the API is not on `http://127.0.0.1:8000`.

```bash
# terminal 1 — this service
uvicorn ai_tutor_v2.main:app --reload --port 8000

# terminal 2 — Next app from the repo root
npm run dev
```

Open `http://localhost:3000/ai-tutor-v2`.

# Teaching backend (Python)

This folder is the current tutor only. The Next.js `/ai-tutor` page calls it through `web_session.py`.

AI Tutor v2.0 is a separate FastAPI service in `ai-tutor-v2/`. Do not add v2 lesson, Scene IR, or streaming code here.

Interactive CLI that detects misconceptions, switches teaching strategies, and opens visual lessons.

## Requirements

- Python **3.10+** (`python3 --version`)
- Repo-root `.env` or `.env.local` with either:
  - `GROQ_API_KEY=…` (default), or
  - `LLM_PROVIDER=openai` and `OPENAI_API_KEY=…`
- Optional: `TAVILY_API_KEY` for web-grounded visuals

No `pip install` needed (stdlib only).

## Run locally (CLI)

From the **repo root**:

```bash
# Verify env + Python
npm run backend:check
# or: ./backend/run.sh --check
# or: python3 backend/main.py --check

# Interactive loop (use a real terminal)
npm run backend
npm run backend -- "octet rule"
./backend/run.sh
python3 backend/main.py --no-open
```

Type answers at the `>` prompt. `quit` exits.

## Run via the web UI

```bash
npm run dev
```

Open [http://localhost:3000/ai-tutor](http://localhost:3000/ai-tutor). Next spawns `backend/web_session.py` with `python` / `python3` (override with `PYTHON_PATH`).

## Useful flags

| Flag | Meaning |
|------|---------|
| `--check` | Print setup status and exit |
| `--self-test` | Offline smoke of parsers / helpers |
| `--no-open` | Do not open generated visuals in a browser |
| `topic…` | Seed the first topic |

## Layout

| File | Role |
|------|------|
| `main.py` | CLI entry → teaching loop |
| `run.sh` | Local launcher (finds `python3`, checks env) |
| `teaching-loop.py` | Ask → detect → teach → judge |
| `web_session.py` | JSON stdin/stdout for `/api/ai-tutor` |
| `Misconception.py` | Diagnosis + shared `.env` / LLM client |
| `interactive-visual-lesson.py` | Visual generation |
| `out/` | Logs / session artifacts (gitignored) |

# SeeThrough: AI Tutor v2.0

AI Tutor v2.0 is a new lesson service. It lives in `ai-tutor-v2/` and does not share code, routes, or a database with the current `/ai-tutor` page or the `backend/` teaching CLI.

It turns a learner's question into a spoken, visual explanation. A tutor plans what to teach, a renderer draws the explanation step by step, and the learner can pause, ask a follow-up, or explore a different example at any time.

This document describes a scalable architecture intended to support questions across subjects. The system is open-ended at the conversation layer, while its visual output is composed from a growing set of validated scene primitives and subject-specific renderers. New topics should be added by extending capabilities and examples, not by rewriting the core app for every question.

## Product goals

- Accept natural-language questions across academic and practical topics.
- Explain with narration, diagrams, annotations, highlights, and an animated cursor.
- Keep speech and board activity in sync.
- Let learners interrupt, ask questions, replay, step backward, and change the explanation.
- Support multiple explanation modes: conceptual overview, worked example, process, comparison, timeline, spatial explanation, and code walkthrough.
- Work on desktop, tablet, and mobile, with keyboard and screen-reader alternatives.
- Keep lessons editable and reproducible through structured data rather than generated video alone.
- Add new visual capabilities without changing the lesson player or conversation APIs.

## Non-goals for the first release

- Perfectly animate every conceivable concept without fallbacks.
- Let a language model emit arbitrary JavaScript, HTML, SVG, or executable code.
- Produce photorealistic visuals or 3D scenes for every question.
- Require a generative video model for the live whiteboard experience.

## Core design principle

The model should decide **what the learner should see and hear**. Application code should decide **how that plan is drawn and animated**.

The model emits a typed lesson plan using a constrained visual language (Scene IR). The server validates it, resolves unsupported actions, and returns a stream of lesson events. The client renders those events using deterministic React/SVG components. This boundary makes the experience safer, testable, replayable, and extensible.

```mermaid
flowchart LR
    U[Question and learner context] --> O[Orchestrator]
    O --> P[Lesson planner]
    P --> V[Validate and normalize Scene IR]
    V --> E[Lesson event stream]
    E --> R[Board renderer]
    E --> T[Narration and timeline]
    R --> U2[Interactive learner]
    T --> U2
    U2 -->|question, pause, or redirect| O
```

## Experience architecture

### 1. Understand the learner's request

Collect the question and optional context: learner age or level, prior knowledge, preferred depth, language, and whether they want an example. Do not force setup before the first answer. Infer reasonable defaults and allow the learner to change them.

The orchestrator classifies the request into an explanation mode, identifies concepts and entities, and decides whether retrieval or a specialized solver is needed. Classification should guide planning, not limit what the learner is allowed to ask.

### 2. Plan a lesson

The planner creates a short sequence of teachable beats. Each beat contains one learning objective, a narration segment, a board-state change, and optional checks for understanding. Keep beats small enough to stream and interrupt.

Example beat types:

- `introduce`: title, definition, or framing question
- `show`: draw or reveal a visual
- `transform`: animate a change from one state to another
- `compare`: show two or more related items
- `work_example`: walk through a concrete example
- `check`: ask the learner a question
- `summarize`: recap the key idea

The planner may call tools such as web retrieval, a calculator, a code parser, or a domain solver. Tool results must be represented in the lesson plan with their provenance when they affect factual claims.

### 3. Validate the visual plan

The server validates every action against a versioned schema before sending it to a client. Validation checks include supported action types, required fields, text length, coordinate and size limits, reference integrity, maximum scene complexity, and safe URL or asset handling.

When an action is invalid or unsupported, normalize it to a safe fallback such as a text card, a simple diagram, or a narrated explanation. Do not fail the entire lesson because one visual could not be drawn.

### 4. Render and narrate

The client lays out shapes in logical board coordinates, animates them, and follows the active action with a cursor. Narration segments carry event IDs and timing metadata. Playback follows one canonical timeline so pause, seek, replay, and interruption affect both audio and visuals together.

### 5. Continue the conversation

When the learner interrupts, save the current board state and playback position. Send the current question, lesson summary, board object IDs, and recent events to the orchestrator. The next plan should refer to existing objects by ID and append, update, or remove them explicitly. If the learner asks to start over, create a new lesson branch.

## Recommended stack

Use TypeScript for the web client and Python for the backend. Keep a versioned JSON contract between them so either side can change independently.

| Area | Initial choice | Reason |
| --- | --- | --- |
| Web app | Next.js, React, TypeScript | Product UI, routing, server endpoints, broad ecosystem |
| Board renderer | React + SVG | Crisp diagrams, accessible labels, easy path and shape animation |
| Animation | Motion for React or Web Animations API | Sequenced SVG drawing, transforms, and cursor movement |
| API | Python with FastAPI | Async endpoints, validation, OpenAPI docs, and event streaming |
| Persistence | PostgreSQL | Users, lessons, events, versions, feedback, and billing records |
| Ephemeral coordination | Redis when needed | Rate limits, short-lived stream state, job coordination |
| Object storage | S3-compatible storage when needed | Audio and user-provided assets |
| Observability | OpenTelemetry-compatible traces, structured logs, product analytics | Diagnose latency, failures, and lesson quality |

Avoid starting with microservices. Keep planner, validation, retrieval adapters, and lesson persistence as modules in a modular monolith. Extract a service only when traffic, deployment ownership, or a distinct scaling profile justifies it.

## System components

### Web client

- `QuestionComposer`: question entry and learner settings.
- `LessonPlayer`: playback state, narration, speed, pause, replay, and step controls.
- `Whiteboard`: stable coordinate plane and viewport controls.
- `SceneRenderer`: renders Scene IR nodes through registered renderers.
- `Cursor`: animated pointer with drawing, pointing, and emphasis states.
- `Transcript`: narration text, captions, and seekable lesson beats.
- `FollowUpComposer`: interruption and question handling.
- `AccessibilityControls`: keyboard navigation, reduced-motion handling, and text-only lesson access.

The board should keep a normalized world coordinate system (for example, 0–1000 units wide) and scale it to the viewport. Keep camera movement separate from scene geometry. Use semantic SVG elements for normal diagrams; add a canvas renderer only if measured scene sizes make SVG too slow.

### API and orchestration

- Authenticate the user and enforce quotas.
- Create or resume a lesson session.
- Build the model context from the request, learner settings, and existing board state.
- Call the planner and any required tools.
- Validate and normalize the plan.
- Stream ordered events to the client.
- Persist the lesson plan, events, and feedback asynchronously or in bounded batches.

Implement the API and orchestration in Python with FastAPI. Use Server-Sent Events (SSE) for one-way lesson event streaming in the initial version. Use WebSockets only if the product later requires sustained bidirectional events such as live collaboration or real-time voice conversation. The client can submit interruptions through a regular API request that cancels or branches the active generation.

### Lesson planner

Keep prompting and model-specific code behind a `LessonPlanner` interface. The planner should return structured data validated against the same schema used by the client. Support model routing by task: a fast model for intent classification or small follow-ups, and a stronger model for complex planning when evaluation shows it improves lesson quality.

Planner responsibilities:

1. Identify the question, likely learner intent, and missing assumptions.
2. Choose an explanation mode and a visual strategy.
3. Break the explanation into short beats.
4. Produce narration and visual actions for each beat.
5. Link claims to retrieval/tool evidence when used.
6. Include a fallback if the requested visual cannot be represented.
7. Keep the plan within latency, token, action-count, and text-length budgets.

The model must never return executable code for the browser. Tool calls run on the server through allowlisted adapters with timeouts, quotas, and typed inputs.

### Visual capability registry

The registry maps Scene IR node types to renderers, validation rules, layout hints, and fallback renderers. Add new visual skills by registering a new node type and tests. Existing lesson events should remain renderable by older clients or be migrated through a versioned adapter.

Possible capability packs:

- General: text, arrows, boxes, labels, highlights, grouping, sequence, comparison.
- Math: number line, equation, graph, fraction, geometric construction.
- Science: particle, cell, circuit, force, cycle, timeline, labeled anatomy.
- Computing: code block, variable store, array, graph, tree, stack, queue, network.
- Humanities: timeline, map marker, relationship graph, cause-and-effect chain.
- Practical skills: checklist, decision tree, process flow, annotated object.

These are progressively added capabilities, not separate apps. The planner can compose simple primitives when a specialized renderer does not exist.

## Scene IR: a safe visual language

Scene IR is the versioned contract between the planner and renderer. Use JSON Schema or Zod for validation and generate TypeScript types from one canonical schema. Keep presentation styles separate from content where possible.

### Initial TypeScript shape

```ts
export type Point = { x: number; y: number };

export type SceneNode =
  | { id: string; type: "text"; x: number; y: number; text: string; role?: "title" | "label" | "body" }
  | { id: string; type: "box"; x: number; y: number; width: number; height: number; label?: string }
  | { id: string; type: "circle"; x: number; y: number; radius: number; label?: string }
  | { id: string; type: "arrow"; from: Point; to: Point; label?: string; style?: "solid" | "dashed" }
  | { id: string; type: "path"; points: Point[]; smooth?: boolean }
  | { id: string; type: "highlight"; targetId: string; style?: "ring" | "underline" | "glow" }
  | { id: string; type: "code"; x: number; y: number; language: string; code: string; highlights?: number[] }
  | { id: string; type: "chart"; x: number; y: number; spec: ChartSpec }
  | { id: string; type: "group"; label?: string; childIds: string[] };

export type BoardAction =
  | { type: "create"; node: SceneNode; animation?: "draw" | "fade" | "pop" | "none" }
  | { type: "update"; id: string; patch: Partial<SceneNode>; animation?: "morph" | "fade" | "none" }
  | { type: "remove"; id: string; animation?: "fade" | "none" }
  | { type: "point"; targetId: string; emphasisMs?: number }
  | { type: "camera"; x: number; y: number; zoom: number };

export type LessonBeat = {
  id: string;
  objective: string;
  narration: string;
  boardActions: BoardAction[];
  checkForUnderstanding?: { prompt: string; expectedConcept?: string };
  evidence?: Array<{ sourceId: string; claim: string }>;
};

export type LessonPlan = {
  schemaVersion: "1.0";
  lessonId: string;
  title: string;
  mode: "concept" | "worked_example" | "process" | "comparison" | "timeline" | "code_walkthrough" | "mixed";
  beats: LessonBeat[];
};
```

This is a starting contract, not a requirement to expose every node type at launch. Place upper limits on the number of beats, nodes, points per path, characters per text node, and total serialized bytes. Validate that IDs are unique, references exist, dimensions are positive, and all numbers are finite and within board limits.

### Layout strategy

Do not depend on the model to calculate perfect coordinates. The model should express relationships and rough intent; a deterministic layout pass should place objects. For example, a sequence uses a horizontal or vertical layout, a comparison uses columns, and a process uses a flow layout. Permit explicit coordinates for fine adjustments, but validate and clamp them. The renderer should reflow for different screen sizes without changing the meaning of the scene.

## Event protocol

The lesson plan is durable content; events are the ordered playback representation. Send events with monotonically increasing sequence numbers so clients can recover after a disconnect.

Example SSE stream:

```text
event: lesson.started
data: {"lessonId":"l_123","schemaVersion":"1.0"}

event: beat.started
data: {"seq":1,"beatId":"b_1","objective":"Introduce the idea"}

event: narration.text
data: {"seq":2,"beatId":"b_1","text":"A hash map stores values by key."}

event: board.action
data: {"seq":3,"beatId":"b_1","action":{"type":"create","node":{"id":"map1","type":"box","x":0,"y":0,"width":180,"height":90,"label":"Hash map"},"animation":"draw"}}

event: beat.completed
data: {"seq":4,"beatId":"b_1"}
```

Useful event types include `lesson.started`, `lesson.plan`, `beat.started`, `narration.text`, `narration.audio.ready`, `board.action`, `check.started`, `check.answered`, `beat.completed`, `lesson.paused`, `lesson.completed`, `lesson.error`, and `lesson.cancelled`.

If text-to-speech is used, store audio by segment and associate each segment with a beat. The board timeline can use segment durations and optional word/phrase timestamps. Start with sentence-level synchronization; add word-level alignment only if learner testing shows it is valuable.

## API outline

### `POST /api/v2/lessons`

Create a lesson.

```json
{
  "question": "Why do seasons happen?",
  "learner": { "level": "beginner", "language": "en" },
  "preferences": { "mode": "mixed", "includeExample": true }
}
```

Return `201` with `lessonId`, `eventsUrl`, and the first available plan metadata. The stream should begin quickly with a status or first beat; do not wait for every optional media asset before responding.

### `GET /api/v2/lessons/:lessonId/events`

Open an SSE stream. Support `Last-Event-ID` or a sequence cursor so a client can resume missed events. Send heartbeat comments during long tool calls.

### `POST /api/v2/lessons/:lessonId/interactions`

Submit an interruption or response.

```json
{
  "kind": "question",
  "text": "Does that happen because Earth is closer to the Sun?",
  "playback": { "beatId": "b_3", "positionMs": 8200 }
}
```

Other interaction kinds include `pause`, `resume`, `repeat`, `simplify`, `give_example`, `change_mode`, and `start_over`.

### `GET /api/v2/lessons/:lessonId`

Return lesson metadata, current version, transcript, and a snapshot or reference to the event history.

### `POST /api/v2/lessons/:lessonId/feedback`

Collect optional feedback such as “helpful,” “too fast,” “diagram unclear,” or free text. Do not use a feedback score as a substitute for evaluating factual correctness.

## Persistence model

Start with these PostgreSQL entities:

- `users`: account and preference reference.
- `lessons`: owner, title, input question, status, selected mode, created/updated times.
- `lesson_versions`: parent version, schema version, planner/model metadata, plan JSON, and generation status.
- `lesson_events`: lesson/version ID, sequence number, event type, payload JSON, created time.
- `lesson_assets`: audio or image object key, content type, size, and ownership metadata.
- `lesson_feedback`: user rating, category, text, and referenced beat or node.
- `tool_runs`: tool name, status, duration, safe summary, and evidence IDs. Do not store secrets or unnecessary raw data.

Index `(lesson_id, version_id, seq)` for event replay. Keep event payloads append-only. Store snapshots periodically for long lessons so clients need not replay every event. Apply retention and deletion rules to transcripts and uploaded content, and avoid storing sensitive learner details unless needed.

## Streaming and latency

- Return an immediate acknowledgement, then stream planning status and events.
- Generate and validate a compact initial plan before optional audio synthesis.
- Render the first beat while later beats or audio segments are prepared.
- Buffer a small number of beats to avoid visible stalls without making interruptions feel delayed.
- Use cancellation signals when the user changes the question or starts over.
- Add bounded timeouts and retries to retrieval, model, and media services.
- Make each event idempotent by identifying it with lesson, version, and sequence number.
- Track time to first useful visual, not only total lesson generation time.

For perceived smoothness, favor short purposeful animations and stable layout. Avoid moving the whole board on every action. Use `requestAnimationFrame` or a mature animation library, respect reduced-motion settings, and avoid updating the entire React tree every animation frame.

## Extensibility for open-ended questions

No finite set of diagram types can natively represent every possible question. The product can still accept any question by combining:

1. A universal explanation planner that can always produce narration and text-based structure.
2. A shared visual vocabulary of primitives and layouts.
3. Optional domain renderers for concepts that benefit from specialized representations.
4. Retrieval and tools for questions requiring current facts, computation, or code analysis.
5. A graceful text-first fallback when the requested representation is not supported.

For a new domain, add capability examples and evaluation cases first. If the planner reliably selects the capability and the renderer can display it, add the node type to the public Scene IR. Keep older lessons readable through schema migrations or adapters.

## Reliability, safety, and correctness

- Validate all model output on the server and client.
- Render only known node types; treat unknown nodes as unsupported and show a fallback.
- Escape all learner and model text before rendering; never inject raw HTML.
- Do not execute code from plans or retrieved pages.
- Sanitize URLs and proxy external assets through a controlled service if required.
- Apply request size limits, per-user quotas, rate limiting, and tool timeouts.
- Keep secrets server-side and redact them from logs.
- Distinguish retrieved facts from model-generated explanation and show source references when appropriate.
- For medical, legal, financial, or safety-critical topics, use stronger review and product-specific response policies; a whiteboard animation does not make uncertain advice reliable.
- Provide captions and a text transcript. Do not make color the only way to convey meaning.

## Evaluation

Build evaluation before expanding the visual catalog. Use a test set of questions across subjects and levels, and evaluate both what is taught and what appears on the board.

Measure:

- Factual accuracy and appropriate uncertainty.
- Whether the explanation answers the actual question.
- Whether the visual supports the narration and has no broken references.
- Whether layout is readable on target screen sizes.
- Time to first useful visual and time to complete a lesson.
- Interruption recovery: does the follow-up preserve and correctly extend board state?
- Accessibility: keyboard use, captions, contrast, reduced motion, and text-only access.
- Learner outcomes: a short pre/post understanding check and delayed recall where practical.

For every Scene IR node, create schema tests, renderer snapshots, responsive layout cases, and at least one planner example. Maintain a set of adversarial or malformed model outputs to verify validation and fallback behavior.

## Observability and product analytics

Use structured traces with a shared `requestId`, `lessonId`, `versionId`, and `beatId`. Track model and tool latency, validation failures, event delivery gaps, audio failures, renderer errors, and cancellation rates. Avoid logging full private user conversations by default; use redacted metadata and opt-in diagnostic samples.

Product events can include `lesson_requested`, `first_visual_rendered`, `lesson_paused`, `followup_submitted`, `lesson_completed`, `lesson_replayed`, and `feedback_submitted`. Use these to identify friction, not to infer learning from time-on-page alone.

## Repository structure

```text
apps/
  web/                         # Existing Next.js app. AI Tutor v2 UI comes later.
ai-tutor-v2/                   # AI Tutor v2.0 API. Separate from backend/.
  ai_tutor_v2/
    main.py                    # FastAPI app and lifespan
    api/routes/                # Lessons, events, interactions, feedback
    schemas/                   # Pydantic request, response, Scene IR, event models
    services/                  # Orchestration, planning, validation, persistence
    providers/                 # Model, retrieval, and speech provider adapters
    tools/                     # Calculator, search, code, and domain tools
    database/                  # SQLAlchemy models and sessions
  alembic/                     # Migrations
  tests/                       # Unit, API, schema, and evaluation tests
```

Keep package APIs small. The web app should consume the planner and renderer through typed interfaces rather than relying on internal implementation details.

## Local development

Prerequisites: Node.js LTS for the web app; Python 3.12+ and PostgreSQL for AI Tutor v2; plus an API key for the selected model provider. Keep AI Tutor v2 secrets in an untracked `ai-tutor-v2/.env` file and never commit credentials. The existing `backend/` folder is the current tutor and is not part of this service.

```bash
cd ai-tutor-v2
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
docker compose up -d
alembic upgrade head
uvicorn ai_tutor_v2.main:app --reload --port 8000
```

Example environment variables:

```text
AI_TUTOR_V2_DATABASE_URL=postgresql+asyncpg://ai_tutor_v2:ai_tutor_v2@127.0.0.1:5435/ai_tutor_v2
AI_TUTOR_V2_PLANNER=fake
LLM_PROVIDER=groq
GROQ_API_KEY=
REDIS_URL=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=
```

The exact provider and infrastructure are deployment choices. Wrap external services behind interfaces and keep provider-specific payloads out of persisted Scene IR.

## Python backend implementation plan

This section is the implementation source of truth for the backend. The frontend can start as a simple question form, lesson transcript, whiteboard placeholder, and follow-up input. Its only integration contract is the versioned HTTP/SSE API below.

### Backend goals

- Accept any natural-language question and always return a useful explanation.
- Stream a first useful lesson beat quickly, then continue with later beats.
- Produce structured, validated board actions instead of executable frontend code.
- Preserve lesson history so a stream can reconnect and a lesson can replay.
- Support interruptions without discarding the current board state.
- Keep model and tool vendors behind Python interfaces.
- Begin as one deployable application and scale generation separately when necessary.

### Python stack

- **FastAPI** for HTTP APIs, OpenAPI documentation, dependency injection, and SSE.
- **Pydantic** for all request, response, event, and Scene IR validation.
- **SQLAlchemy 2.x async** for database access and **Alembic** for migrations.
- **PostgreSQL** as the durable store for lessons, versions, and ordered events.
- **httpx** or a vendor SDK behind a provider adapter for model and retrieval calls.
- **Redis and a generation worker** only when the app needs durable background jobs or multiple API instances.

FastAPI's SSE endpoint should be a `GET` route. The browser can create a lesson with `POST`, then connect to the returned event URL with `EventSource`. Follow-up questions and other interactions use ordinary `POST` requests.

### Request-to-lesson flow

1. `POST /api/v2/lessons` validates the question and preferences.
2. The API creates a lesson row and first lesson-version row.
3. The orchestrator determines whether the question needs a tool, such as retrieval, calculation, or code parsing.
4. The planner produces one short beat at a time, with narration and proposed visual actions.
5. Pydantic validates each beat; a separate semantic validator checks IDs, references, limits, and allowed node types.
6. The event service assigns sequence numbers and stores events in PostgreSQL.
7. The API's SSE endpoint sends stored/new events to the connected frontend.
8. On interruption, the interaction API records learner input and playback position, then starts a child lesson version that can reference current board nodes.

### Minimal Scene IR in Python

Keep the initial action vocabulary small. Add node types only when the renderer and evaluation examples are ready.

```python
from typing import Annotated, Literal, Union
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Point(StrictModel):
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=1000)


class TextNode(StrictModel):
    id: str
    type: Literal["text"] = "text"
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=1000)
    text: str = Field(min_length=1, max_length=500)
    role: Literal["title", "label", "body"] = "body"


class BoxNode(StrictModel):
    id: str
    type: Literal["box"] = "box"
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=1000)
    width: float = Field(gt=0, le=1000)
    height: float = Field(gt=0, le=1000)
    label: str | None = Field(default=None, max_length=200)


class ArrowNode(StrictModel):
    id: str
    type: Literal["arrow"] = "arrow"
    start: Point
    end: Point
    label: str | None = Field(default=None, max_length=200)


SceneNode = Annotated[
    Union[TextNode, BoxNode, ArrowNode],
    Field(discriminator="type"),
]


class BoardAction(StrictModel):
    type: Literal["create", "update", "remove", "point"]
    node: SceneNode | None = None
    target_id: str | None = None
    animation: Literal["draw", "fade", "pop", "none"] = "draw"


class LessonBeat(StrictModel):
    id: str
    objective: str = Field(max_length=200)
    narration: str = Field(min_length=1, max_length=2000)
    board_actions: list[BoardAction] = Field(max_length=30)


class LessonPlan(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    title: str = Field(min_length=1, max_length=200)
    beats: list[LessonBeat] = Field(min_length=1, max_length=20)
```

The code above is a shape example, not the final complete schema. Add validators for unique IDs, valid `target_id` references, finite values, event size, and allowed state transitions. Persist `schema_version` with every plan so future versions can migrate old lessons.

### HTTP contract

#### Create a lesson — `POST /api/v2/lessons`

Request:

```json
{
  "question": "Why do seasons happen?",
  "learner": { "level": "beginner", "language": "en" },
  "preferences": { "include_example": true }
}
```

Response:

```json
{
  "lesson_id": "les_123",
  "version_id": "ver_1",
  "status": "generating",
  "events_url": "/api/v2/lessons/les_123/events"
}
```

#### Stream lesson events — `GET /api/v2/lessons/{lesson_id}/events`

Return `text/event-stream`; each event has an event name, JSON data, and monotonic sequence ID. Support `Last-Event-ID` so the client can reconnect after losing a connection. Send heartbeat comments during long periods without a new event.

```text
id: 3
event: board.action
data: {"lesson_id":"les_123","version_id":"ver_1","seq":3,"beat_id":"b1","payload":{"type":"create","node":{"id":"n1","type":"box","label":"Sun"}}}
```

#### Submit an interaction — `POST /api/v2/lessons/{lesson_id}/interactions`

```json
{
  "kind": "question",
  "text": "Does Earth being closer to the Sun cause summer?",
  "current_version_id": "ver_1",
  "current_beat_id": "b2",
  "playback_position_ms": 6400
}
```

Return an interaction ID and the new version ID. Stream its answer and board actions through the same lesson event endpoint.

#### Other routes

- `GET /api/v2/lessons/{lesson_id}` — metadata, current version, status, and transcript.
- `POST /api/v2/lessons/{lesson_id}/feedback` — learner feedback tied to a beat or node.
- `GET /health/live` — process is alive.
- `GET /health/ready` — database and required dependencies are reachable.

### Persistence and event replay

Use PostgreSQL tables for `lessons`, `lesson_versions`, `lesson_events`, `lesson_interactions`, `tool_runs`, and `lesson_feedback`. Store plan and event bodies in JSONB, with typed columns for IDs, status, ownership, sequence, and timestamps. Add a unique constraint on `(lesson_id, version_id, sequence)` and an index for replay. Treat events as append-only; use snapshots if lessons grow large.

The SSE route should replay events after the requested sequence, then wait for new ones. For a single-process prototype, an in-memory notification mechanism is acceptable while PostgreSQL remains the source of truth. With multiple API instances, use Redis Pub/Sub or a broker to notify the instance holding the SSE connection; always recover missed events from PostgreSQL.

### Model and tool boundaries

Define small Python protocols or abstract classes:

```python
class LessonPlanner:
    async def plan(self, context) -> LessonPlan: ...


class ModelProvider:
    async def generate_structured(self, *, prompt, schema, timeout_s): ...


class RetrievalProvider:
    async def search(self, query: str, *, limit: int): ...
```

Keep prompts, model names, retries, and vendor-specific response parsing inside the provider/planner modules. Tools should be explicitly allowlisted, typed, time-limited, and logged with safe summaries. The model must never execute generated Python, JavaScript, HTML, or shell commands.

### Open-ended question strategy

Do not try to create a renderer for every question before launch. Use three layers:

1. **General explanation:** every question can receive a clear text/narration lesson divided into beats.
2. **Shared visuals:** compose common ideas from text, boxes, arrows, highlights, sequences, comparisons, and timelines.
3. **Specialized capabilities:** add math, science, computing, map, or process renderers when tests show a real need.

If a requested visual is unsupported, return an explanation with the closest safe visual structure and make the fallback explicit in an internal planner field. Never return invalid board JSON just to appear visual.

### Error handling and cancellation

- Give every request a `request_id`; include it in logs and error responses.
- Use provider timeouts and bounded retries; do not retry malformed model output forever.
- If one beat fails validation, ask the planner for one repair or convert that beat to a text-only fallback.
- If a tool is unavailable, continue without it when possible and state relevant uncertainty.
- Mark generation as `cancelled` when the learner starts over or replaces the question.
- Persist terminal states such as `completed`, `failed`, and `cancelled`.
- Never expose provider stack traces, API keys, or raw internal errors to the frontend.

### Security and cost controls

- Keep model and database credentials on the server.
- Add request-size limits, per-user rate limits, generation token budgets, and tool timeouts.
- Escape all user/model strings in clients; only render known Scene IR node types.
- Do not execute plans or accept arbitrary external asset URLs without validation.
- Redact prompts and personal data from standard logs.
- Track model/tool costs per lesson and enforce configurable quotas.

### Testing and evaluation

- Unit-test each Pydantic schema and semantic validator, including malformed and oversized model output.
- API-test lesson creation, SSE ordering, reconnect by `Last-Event-ID`, and interaction branching.
- Test that replaying persisted events produces the same board state.
- Maintain a small question set across several subjects and learner levels.
- Score factuality, question fit, valid scene output, visual/narration alignment, fallback quality, latency, and estimated cost.
- Track `time_to_first_useful_event`, total generation time, validation failure rate, tool latency, cancellation rate, and follow-up success.

### Build sequence

**Step 1 — Backend skeleton:** create FastAPI app, settings, health routes, PostgreSQL connection, SQLAlchemy models, Alembic migration, and CORS for the local frontend.

**Step 2 — Contract before AI:** define Pydantic schemas and a fake planner that returns a fixed lesson. This lets the frontend be built independently while the backend behavior is deterministic.

**Step 3 — Persistence and events:** save the lesson, version, and ordered events; implement SSE and reconnect; confirm a browser can display a lesson from fake events.

**Step 4 — Real model planner:** add one model provider behind `ModelProvider`; request structured output per beat; validate every response and implement a single repair plus fallback.

**Step 5 — Follow-ups:** add interactions, cancellation, child versions, and board-state references.

**Step 6 — Evidence tools:** add retrieval or calculators only for question categories where they improve correctness; attach source metadata to lesson claims.

**Step 7 — Production hardening:** add authentication, quotas, rate limits, tracing, cost tracking, backups, and deployment health checks.

**Step 8 — Worker scaling:** once requests are long-running or multiple API instances are deployed, move generation into a durable queue worker. Keep FastAPI stateless; keep PostgreSQL as the event source of truth; use Redis or the broker for job dispatch and live notifications.

### Definition of done for the first backend MVP

- A question creates a persisted lesson and returns a stable lesson ID.
- A mock and real planner can produce the same validated LessonPlan contract.
- The frontend receives ordered SSE events and can reconnect without duplicating board actions.
- A follow-up creates a new version while preserving existing board references.
- Unsupported or malformed visuals fall back cleanly to narration/text.
- Secrets remain server-side, errors are bounded, and token/tool limits are enforced.
- API docs are available from FastAPI OpenAPI output for frontend iteration.

## Build plan

### Phase 1: reliable visual lesson loop

- Build the question composer, lesson player, transcript, and SVG board.
- Implement a small Scene IR: text, box, circle, arrow, path, highlight, code block, and simple layouts.
- Have the planner generate a complete short lesson as validated JSON.
- Animate one beat at a time with a cursor and manual play/pause/step controls.
- Add a text-only fallback and collect learner feedback.

### Phase 2: streaming and interruption

- Add SSE events and resumable sequence IDs.
- Add pause, repeat, simplify, example, and follow-up interactions.
- Preserve board state and branch lesson versions when the learner redirects.
- Add audio narration by beat and sentence-level synchronization.

### Phase 3: broader visual skills

- Add layout engines and domain packs based on real learner questions.
- Add retrieval, calculator, and code-analysis adapters where needed.
- Improve responsive layouts, accessibility, and evaluation coverage.
- Introduce snapshots and asset storage as usage requires them.

### Phase 4: scale and personalization

- Route tasks to models based on measured quality, latency, and cost.
- Add queue-backed generation for expensive tools or media jobs.
- Add caching for reusable public reference material and deterministic tool results.
- Add learner preferences and progress only with clear controls and data retention rules.
- Split independently scaling services only when monitoring shows a concrete bottleneck.

## Definition of done for the first MVP

- A learner can ask a question in plain language and receive a coherent narrated or transcript-based lesson.
- The board draws and highlights a useful visual in sync with each explanation beat.
- The learner can pause, replay, step through, and interrupt with a follow-up question.
- Invalid planner output is rejected or converted to a safe fallback without breaking playback.
- The same saved lesson replays consistently from its event history.
- A question outside current diagram skills still receives a clear text-first explanation.
- Core flows work on mobile and with keyboard navigation, captions, and reduced motion.
- Evaluation covers representative questions from more than one subject area.

## Key trade-offs

- **SVG first, canvas when justified:** SVG makes semantic diagrams and individual objects simple. Canvas can help with very large scenes but requires more work for selection, labels, and accessibility.
- **Structured plans, not arbitrary drawing code:** constrained plans are less expressive at first, but much safer and easier to replay and test.
- **Modular monolith, not microservices at launch:** simpler deployment and faster iteration; modules can be extracted when real scaling demands emerge.
- **Universal question input, gradual visual coverage:** accept broad questions while being honest through graceful text-first fallbacks. Visual capability improves through observed use and measured quality.


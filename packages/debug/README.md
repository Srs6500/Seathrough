# @seethrough/debug

Local-only runtime debugging for **Next.js** apps used with Seethrough Bug Analyzer.

When your app runs on your machine, this package:

- Captures **server errors** (route failures, uncaught exceptions, unhandled rejections)
- Records **request traces** (method, path, status, duration, redacted headers/body)
- Writes events to `.seethrough/debug/events.jsonl`
- Serves a tiny collector at `http://127.0.0.1:4319` for Seethrough to read

Disabled in production unless `SEETHROUGH_DEBUG=1`.

## Install

```bash
npm install @seethrough/debug
# or from this monorepo:
npm install file:../path/to/Seathrough/packages/debug
```

## Setup (Next.js App Router)

### 1. Instrumentation (starts collector + process hooks)

`instrumentation.ts` at the project root (or `src/`):

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@seethrough/debug/register");
  }
}
```

Enable in `next.config`:

```js
const nextConfig = {
  experimental: {
    instrumentationHook: true, // Next < 15
  },
};
module.exports = nextConfig;
```

(Next 15+ enables instrumentation by default.)

### 2. Wrap API routes you care about

```ts
// app/api/orders/route.ts
import { withSeethroughDebug } from "@seethrough/debug/next";

export const POST = withSeethroughDebug(async (request) => {
  // your handler
  return Response.json({ ok: true });
});
```

### 3. Run locally

```bash
npm run dev
```

You should see:

```text
[@seethrough/debug] collector on http://127.0.0.1:4319
```

## Collector HTTP API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + project label |
| GET | `/events?limit=100` | Recent events |
| POST | `/ingest` | Push a single event JSON |
| POST | `/clear` | Clear in-memory buffer |

Events are also appended to `.seethrough/debug/events.jsonl` (gitignored in your app).

## Env

| Variable | Meaning |
|----------|---------|
| `SEETHROUGH_DEBUG=1` | Force on (even in production — not recommended) |
| `SEETHROUGH_DEBUG=0` | Force off |
| `SEETHROUGH_DEBUG_DIR` | Override storage directory |
| `SEETHROUGH_DEBUG_PORT` | Collector port (default `4319`) |
| `SEETHROUGH_DEBUG_HOST` | Collector host (default `127.0.0.1`) |
| `SEETHROUGH_DEBUG_PROJECT` | Label stored on events |
| `SEETHROUGH_DEBUG_COLLECTOR=0` | Skip HTTP collector |
| `SEETHROUGH_DEBUG_INGEST` | Extra webhook URL for each event |

## Privacy

Authorization, cookies, and common secret field names are redacted before storage. Only run this on local/dev machines.

## Programmatic API

```ts
import {
  init,
  captureException,
  captureLog,
  listEvents,
  beginRequest,
  endRequest,
} from "@seethrough/debug";

init({ project: "my-app" });
captureException(new Error("boom"));
```

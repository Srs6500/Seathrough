import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DebugEvent, SeethroughDebugOptions } from "./types.js";
import { resolveDir } from "./env.js";

export type DebugStore = {
  push: (event: DebugEvent) => void;
  list: (limit?: number) => DebugEvent[];
  clear: () => void;
  dir: string;
};

export function createStore(options: SeethroughDebugOptions = {}): DebugStore {
  const dir = resolveDir(options);
  const maxEvents = options.maxEvents ?? 500;
  const events: DebugEvent[] = [];
  let ready = false;

  function ensureDir() {
    if (ready) return;
    mkdirSync(dir, { recursive: true });
    ready = true;
  }

  function persist(event: DebugEvent) {
    try {
      ensureDir();
      appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
      writeFileSync(
        join(dir, "latest.json"),
        JSON.stringify({ updatedAt: new Date().toISOString(), event }, null, 2),
        "utf8",
      );
    } catch {
      // local disk best-effort
    }
  }

  async function maybeIngest(event: DebugEvent) {
    const url = options.ingestUrl || process.env.SEETHROUGH_DEBUG_INGEST;
    if (!url) return;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch {
      // collector may be down
    }
  }

  return {
    dir,
    push(event) {
      events.push(event);
      if (events.length > maxEvents) {
        events.splice(0, events.length - maxEvents);
      }
      persist(event);
      void maybeIngest(event);
    },
    list(limit = 100) {
      return events.slice(Math.max(0, events.length - limit));
    },
    clear() {
      events.length = 0;
    },
  };
}

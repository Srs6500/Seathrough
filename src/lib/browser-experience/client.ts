import type {
  BrowserAnnotation,
  BrowserAskResult,
  BrowserFollowUpResult,
  BrowserLessonRole,
  BrowserSessionPublic,
  BrowserStreamEvent,
  BrowserTeachBeat,
} from "@/lib/browser-experience/types";

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    return { error: "Unexpected response from the browser tutor." } as T & {
      error?: string;
    };
  }
}

export async function requestBrowserAsk(
  prompt: string,
  options?: {
    sessionId?: string;
    signal?: AbortSignal;
    onEvent?: (event: BrowserStreamEvent) => void;
  },
): Promise<BrowserAskResult> {
  const res = await fetch("/api/browser-experience/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    }),
    signal: options?.signal,
  });

  if (!res.ok || !res.body) {
    const body = await readJson<{ error?: string }>(res);
    throw new Error(
      body.error || "Could not start the browser lesson. Try again.",
    );
  }

  return consumeBrowserStream(res.body, options?.onEvent);
}

export async function requestBrowserFollowUp(
  sessionId: string,
  prompt: string,
  options?: {
    signal?: AbortSignal;
    onEvent?: (event: BrowserStreamEvent) => void;
  },
): Promise<BrowserFollowUpResult> {
  const res = await fetch("/api/browser-experience/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, prompt }),
    signal: options?.signal,
  });

  if (!res.ok || !res.body) {
    const body = await readJson<{ error?: string }>(res);
    throw new Error(body.error || "Could not answer that follow-up.");
  }

  return consumeBrowserStream(res.body, options?.onEvent);
}

async function consumeBrowserStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: (event: BrowserStreamEvent) => void,
): Promise<BrowserAskResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let session: BrowserSessionPublic | null = null;
  let beats: BrowserTeachBeat[] = [];
  let summary = "";
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .map((part) => part.trim())
        .find((part) => part.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let event: BrowserStreamEvent;
      try {
        event = JSON.parse(raw) as BrowserStreamEvent;
      } catch {
        continue;
      }
      onEvent?.(event);
      if (event.type === "session") session = event.session;
      if (event.type === "beats") {
        beats = event.beats;
        summary = event.summary;
      }
      if (event.type === "error") streamError = event.error;
    }
  }

  if (streamError) throw new Error(streamError);
  if (!session) {
    throw new Error("Could not start the browser lesson. Try again.");
  }
  return { session, beats, summary };
}

export async function annotateBrowserSession(
  sessionId: string,
  annotation: BrowserAnnotation,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/browser-experience/annotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, annotation }),
    signal,
  });
  if (!res.ok) {
    const body = await readJson<{ error?: string }>(res);
    throw new Error(body.error || "Could not highlight that on the page.");
  }
}

export async function switchBrowserRole(
  sessionId: string,
  role: Exclude<BrowserLessonRole, "act">,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, role }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not switch to that lesson step.");
  }
  return body.session;
}

export async function activateBrowserTab(
  sessionId: string,
  tabId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/tab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action: "activate", tabId }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not switch tabs.");
  }
  return body.session;
}

export async function closeBrowserTab(
  sessionId: string,
  tabId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/tab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action: "close", tabId }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not close that tab.");
  }
  return body.session;
}

export async function openBrowserTab(
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/tab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action: "new" }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not open a new tab.");
  }
  return body.session;
}

/** Muse-style omnibox — URL or Google search query on the active tab. */
export async function navigateBrowserOmnibox(
  sessionId: string,
  url: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/tab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action: "navigate", url }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not open that page.");
  }
  return body.session;
}

export async function reloadBrowserTab(
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/tab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action: "reload" }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not reload that tab.");
  }
  return body.session;
}

export async function fetchBrowserSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic | null> {
  const res = await fetch(
    `/api/browser-experience/session?sessionId=${encodeURIComponent(sessionId)}`,
    { signal, cache: "no-store" },
  );
  if (!res.ok) return null;
  const body = await readJson<{ session?: BrowserSessionPublic }>(res);
  return body.session ?? null;
}

export async function takeBrowserControl(
  sessionId: string,
  reason?: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      action: "take",
      ...(reason ? { reason } : {}),
    }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not take control of the browser.");
  }
  return body.session;
}

export async function resumeBrowserControl(
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action: "resume" }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not resume the lesson yet.");
  }
  return body.session;
}

/** Remint LiveURL — no-op on server (Phase 0); kept for older clients. */
export async function refreshBrowserLiveView(
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionPublic> {
  const res = await fetch("/api/browser-experience/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action: "refresh_live" }),
    signal,
  });
  const body = await readJson<{ session?: BrowserSessionPublic; error?: string }>(
    res,
  );
  if (!res.ok || !body.session) {
    throw new Error(body.error || "Could not refresh the live browser view.");
  }
  return body.session;
}

/** Forward a click/key into the remote page while Take control is active. */
export async function sendBrowserInput(
  sessionId: string,
  input: {
    type: "click" | "dblclick" | "type" | "key";
    xNorm?: number;
    yNorm?: number;
    text?: string;
    key?: string;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/browser-experience/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...input }),
    signal,
  });
  if (!res.ok) {
    const body = await readJson<{ error?: string }>(res);
    throw new Error(body.error || "Could not send input to the browser.");
  }
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  await fetch("/api/browser-experience/session", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => undefined);
}

export async function fetchBrowserFrame(
  sessionId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await fetch(
    `/api/browser-experience/frame?sessionId=${encodeURIComponent(sessionId)}`,
    { signal, cache: "no-store" },
  );
  if (!res.ok) return null;
  const body = await readJson<{ image?: string }>(res);
  return typeof body.image === "string" ? body.image : null;
}

export async function speakBrowserLine(
  text: string,
  signal?: AbortSignal,
): Promise<{ mimeType: string; base64: string } | null> {
  const res = await fetch("/api/experiment/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) return null;
  const body = await readJson<{ mimeType?: string; base64?: string }>(res);
  if (!body.mimeType || !body.base64) return null;
  return { mimeType: body.mimeType, base64: body.base64 };
}

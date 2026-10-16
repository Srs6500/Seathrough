import OpenAI from "openai";
import { z } from "zod";
import { getLlmConfig } from "@/lib/env";
import type { SourceRef } from "@/lib/bug-analyzer/debugEvents";

export const errorExplanationSchema = z.object({
  whatFailed: z.string().min(1),
  whyLikely: z.string().min(1),
  /** Short plain-language summary for the AI Explanation tab. */
  summary: z.string().min(1).optional(),
  /** Ordered story of what happened leading to the failure. */
  whatHappened: z.array(z.string().min(1)).max(8).optional(),
  suggestedFix: z
    .object({
      instruction: z.string().min(1),
      snippet: z.string().optional(),
    })
    .optional(),
  investigate: z
    .array(
      z.object({
        path: z.string().optional(),
        line: z.number().int().positive().optional(),
        reason: z.string().min(1),
      }),
    )
    .min(1)
    .max(6),
  nextSteps: z.array(z.string().min(1)).min(1).max(6),
  confidence: z.enum(["low", "medium", "high"]),
});

export type ErrorExplanation = z.infer<typeof errorExplanationSchema>;

export type ExplainErrorInput = {
  name?: string;
  message?: string;
  stack?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  bodyPreview?: string;
  sourceRefs?: SourceRef[];
  /** Optional static analysis hints (file paths / API routes). */
  codeHints?: string[];
};

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced?.[1]?.trim() || trimmed;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  return JSON.parse(text);
}

function isSuccessfulRequest(input: ExplainErrorInput): boolean {
  const status = input.statusCode;
  if (typeof status !== "number" || status < 200 || status >= 400) return false;
  if (input.stack?.trim()) return false;
  const msg = (input.message || "").trim();
  if (!msg) return true;
  if (/^request (completed|succeeded)/i.test(msg)) return true;
  // Captured exception text means this is still a failure explanation.
  if (/failed|exception|timeout|econn|enotfound|unauthorized|forbidden/i.test(msg)) {
    return false;
  }
  return !input.name || input.name === "Error";
}

/** Deterministic fallback when the LLM is unavailable. */
export function heuristicExplain(input: ExplainErrorInput): ErrorExplanation {
  const path = input.path || input.sourceRefs?.[0]?.path || "the route";
  const line = input.sourceRefs?.[0]?.line;
  const status = input.statusCode;
  const routeHint = path.startsWith("/")
    ? `app${path}/route.ts`.replace(/\/+/g, "/")
    : path;

  const investigate =
    (input.sourceRefs?.length ?? 0) > 0
      ? input.sourceRefs!.slice(0, 4).map((ref) => ({
          path: ref.path,
          line: ref.line,
          reason: "Appears in the stack / request path.",
        }))
      : [
          {
            path: routeHint,
            line,
            reason: "Handler for this request path.",
          },
        ];

  if (isSuccessfulRequest(input)) {
    const label = input.method
      ? `${input.method} ${input.path || path}`
      : input.path || path;
    return {
      whatFailed: `${label} completed successfully (${status}).`,
      whyLikely: `This request finished with HTTP ${status}. There is no failure to fix — the handler returned a normal response.`,
      summary: `This request succeeded with status ${status}. No error was captured.`,
      whatHappened: [
        input.method && input.path
          ? `Client called ${input.method} ${input.path}.`
          : "A server request was handled.",
        `The handler responded with status ${status}.`,
        "No exception or error event was attached to this request.",
      ],
      investigate,
      nextSteps: [
        "If you expected a bug, open a request that shows Failed (4xx/5xx) instead.",
        "Use Project Overview for static analysis of the selected repo.",
        "Reproduce a failing path (bad input, missing auth, thrown error) and reopen Debug Sessions.",
      ],
      confidence: "high",
    };
  }

  const msg = (input.message || "Unknown error").trim();

  let why = `The server reported: ${msg}.`;
  if (status && status >= 500) {
    why +=
      " A 5xx status usually means an unhandled exception or upstream failure in the route handler.";
  } else if (status && status >= 400) {
    why +=
      " A 4xx status often means bad input, missing auth, or a rejected precondition.";
  }

  const whatFailed = input.method
    ? `${input.method} ${input.path || path} failed${status ? ` (${status})` : ""}: ${msg}`
    : msg;

  return {
    whatFailed,
    whyLikely: why,
    summary: why,
    whatHappened: [
      input.method && input.path
        ? `Client called ${input.method} ${input.path}.`
        : "A server request was handled.",
      status
        ? `The handler responded with status ${status}.`
        : "The handler failed before returning a status.",
      `Error message: ${msg}`,
    ],
    suggestedFix: {
      instruction:
        "Open the top stack frame, reproduce the request, and verify env vars / inputs the handler depends on.",
      snippet: investigate[0]?.path
        ? `// Start here\n// ${investigate[0].path}${investigate[0].line != null ? `:${investigate[0].line}` : ""}`
        : undefined,
    },
    investigate,
    nextSteps: [
      "Open the top source location and read the handler around the failing line.",
      "Reproduce with the same method/path and watch the session timeline.",
      "Check auth, request body shape, and any external service the handler calls.",
    ],
    confidence: input.stack || (input.sourceRefs?.length ?? 0) > 0 ? "medium" : "low",
  };
}

export async function explainErrorWithAi(
  input: ExplainErrorInput,
): Promise<{ explanation: ErrorExplanation; source: "ai" | "heuristic" }> {
  const fallback = heuristicExplain(input);
  try {
    const cfg = getLlmConfig();
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });

    const completion = await client.chat.completions.create({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: `You are a senior Next.js/TypeScript debugger for Seethrough Bug Analyzer.
Explain runtime requests for developers. Be concrete and practical.
Return ONLY valid JSON matching this shape:
{
  "whatFailed": string,
  "whyLikely": string,
  "summary": string,
  "whatHappened": string[],
  "suggestedFix": {"instruction": string, "snippet"?: string},
  "investigate": [{"path"?: string, "line"?: number, "reason": string}],
  "nextSteps": string[],
  "confidence": "low"|"medium"|"high"
}
Rules:
- If statusCode is 2xx/3xx and there is no real error/stack, say the request succeeded. Do NOT invent a failure. Omit suggestedFix. Use whatFailed for a one-line success headline.
- Otherwise whatFailed: one sentence, what broke.
- whyLikely / summary: plain English (2–4 sentences). Do not invent secrets.
- whatHappened: 2–5 short chronological steps.
- suggestedFix: only for real failures — concrete fix + optional short snippet.
- investigate: 1–4 places to look, prefer stack file:line when present.
- nextSteps: 2–4 actionable checks.
- Mark confidence low if evidence is thin.
- Assume Next.js App Router unless evidence says otherwise.`,
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              error: {
                name: input.name,
                message: input.message,
                stack: input.stack?.slice(0, 4000),
              },
              request: {
                method: input.method,
                path: input.path,
                statusCode: input.statusCode,
                bodyPreview: input.bodyPreview?.slice(0, 500),
              },
              sourceRefs: input.sourceRefs?.slice(0, 8),
              codeHints: input.codeHints?.slice(0, 24),
            },
            null,
            2,
          ),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = errorExplanationSchema.parse(extractJson(raw));
    return { explanation: parsed, source: "ai" };
  } catch {
    return { explanation: fallback, source: "heuristic" };
  }
}

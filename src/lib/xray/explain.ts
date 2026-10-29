import OpenAI from "openai";
import { z } from "zod";
import { envPresence, getLlmConfig } from "@/lib/env";
import type { XRayAskPayload, XRayAskResult } from "@/lib/xray/types";

export const xrayAskSchema = z.object({
  question: z.string().trim().min(1).max(500),
  feature: z.object({
    name: z.string().min(1).max(80),
    headline: z.string().max(400).optional().default(""),
    explanation: z.string().max(2000).optional().default(""),
    connections: z.array(z.string().max(80)).max(12).optional().default([]),
    verifyNext: z.array(z.string().max(240)).max(6).optional().default([]),
    findings: z
      .array(
        z.object({
          title: z.string().max(200),
          summary: z.string().max(600),
          contradiction: z.string().max(600).optional(),
          evidence: z
            .array(
              z.object({
                file: z.string().max(240),
                startLine: z.number().int().positive().optional(),
                snippet: z.string().max(800).optional(),
              }),
            )
            .max(6)
            .optional()
            .default([]),
        }),
      )
      .max(8)
      .optional()
      .default([]),
    relevantCode: z
      .array(
        z.object({
          file: z.string().max(240),
          startLine: z.number().int().positive().optional(),
          snippet: z.string().max(800).optional(),
        }),
      )
      .max(8)
      .optional()
      .default([]),
    selectedNode: z
      .object({
        label: z.string().max(80),
        kind: z.string().max(40),
        file: z.string().max(240).optional(),
      })
      .optional(),
  }),
});

export function xrayWriterMissing(): boolean {
  const presence = envPresence();
  if (presence.LLM_PROVIDER === "openai") return !presence.OPENAI_API_KEY;
  return !presence.GROQ_API_KEY;
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fence?.[1]?.trim() || trimmed;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Could not explain that feature.");
  }
}

export function heuristicFeatureAnswer(payload: XRayAskPayload): XRayAskResult {
  const q = payload.question.toLowerCase();
  const feature = payload.feature;
  const finding = feature.findings[0];
  const code = feature.relevantCode[0] || finding?.evidence[0];
  const node = feature.selectedNode;
  const citations = [
    ...(code ? [{ file: code.file, startLine: code.startLine }] : []),
    ...(node?.file ? [{ file: node.file }] : []),
  ].filter((c, i, arr) => arr.findIndex((x) => x.file === c.file) === i);

  if (node && /this|what is|what does|node|component|handler|page/.test(q)) {
    return {
      answer: [
        `${node.label} is a ${node.kind} in ${feature.name}.`,
        node.file ? `It lives in ${node.file}.` : "",
        finding ? finding.summary : feature.explanation,
      ]
        .filter(Boolean)
        .join(" "),
      citations,
      source: "heuristic",
    };
  }

  if (/safe|secure|risk|auth|password|credential/.test(q) && finding) {
    return {
      answer: [
        `The scan flagged a possible risk in ${feature.name}: ${finding.title}.`,
        finding.contradiction || finding.summary,
        code?.file
          ? `Look at ${code.file}${code.startLine ? `:${code.startLine}` : ""} for the evidence used.`
          : "",
        "Treat this as something to verify, not a proof that an attacker already got in.",
      ]
        .filter(Boolean)
        .join(" "),
      citations,
      source: "heuristic",
    };
  }

  if (/connect|flow|how|work/.test(q)) {
    const path = feature.connections.join(" → ");
    return {
      answer: [
        path
          ? `${feature.name} currently connects ${path}.`
          : `${feature.name} was found, but the connection path is still thin.`,
        feature.explanation,
      ]
        .filter(Boolean)
        .join(" "),
      citations,
      source: "heuristic",
    };
  }

  return {
    answer: [
      feature.explanation,
      finding ? `Main flag: ${finding.title}. ${finding.summary}` : "",
      feature.verifyNext[0]
        ? `A useful next check: ${feature.verifyNext[0]}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    citations,
    source: "heuristic",
  };
}

const answerSchema = z.object({
  answer: z.string().min(1).max(1200),
  citations: z
    .array(
      z.object({
        file: z.string().min(1),
        startLine: z.number().int().positive().optional(),
      }),
    )
    .max(6)
    .optional()
    .default([]),
});

export async function answerFeatureQuestion(
  payload: XRayAskPayload,
): Promise<XRayAskResult> {
  const fallback = heuristicFeatureAnswer(payload);
  if (xrayWriterMissing()) return fallback;

  try {
    const cfg = getLlmConfig();
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    const completion = await client.chat.completions.create({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You explain one application feature to a beginner who just connected GitHub.
Return JSON {"answer":"...","citations":[{"file":"path","startLine":12}]}.
Rules:
- Short paragraphs, plain words. No jargon unless you define it.
- Only cite files that appear in the provided evidence.
- Do not invent files, APIs, or vulnerabilities.
- If evidence is thin, say what is unknown.
- Never give exploit steps.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            question: payload.question,
            feature: payload.feature,
          }),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = answerSchema.parse(extractJson(raw));
    const allowed = new Set(
      [
        ...payload.feature.relevantCode.map((c) => c.file),
        ...payload.feature.findings.flatMap((f) =>
          f.evidence.map((e) => e.file),
        ),
        payload.feature.selectedNode?.file,
      ].filter(Boolean),
    );
    const citations = parsed.citations.filter((c) => allowed.has(c.file));
    return {
      answer: parsed.answer.trim(),
      citations: citations.length ? citations : fallback.citations,
      source: "ai",
    };
  } catch {
    return fallback;
  }
}

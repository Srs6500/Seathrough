import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import {
  alignUmlWithLessonText,
  layoutUmlClassPlan,
  pruneUmlToLessonMentions,
} from "@/lib/draw-engine/umlLayout";
import {
  umlDiagramPlanSchema,
  type UmlDiagramPlan,
} from "@/lib/draw-engine/umlSchema";

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getClient() {
  const openaiKey = optionalEnv("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      client: getTrackedOpenAI({ apiKey: openaiKey }),
      model: optionalEnv("OPENAI_MODEL") ?? "gpt-4.1",
    };
  }
  const cfg = getLlmConfig();
  return {
    client: getTrackedOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }),
    model: cfg.model,
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("UML plan was not valid JSON");
}

const SYSTEM = `You design ONE complete UML diagram as JSON for a tutoring whiteboard.

Return ONLY valid JSON:
{
  "title": string,
  "kind": "class" | "sequence",
  "domain": string,
  "classes": [
    {
      "id": "c1",
      "name": "Vehicle",
      "attributes": ["- make: String", "- model: String", "- year: Integer"],
      "methods": ["+ start()"],
      "x": 100,
      "y": 80,
      "revealBeat": 1
    }
  ],
  "relationships": [
    {
      "id": "r1",
      "from": "c2",
      "to": "c1",
      "kind": "inheritance",
      "label": "extends",
      "revealBeat": 2
    }
  ],
  "actors": [],
  "messages": []
}

Rules:
1. Classes/actors MUST match the user's domain EXACTLY. NEVER invent unrelated names like Animal/Dog/Cat, Detailed, Service unless asked.
2. If the LESSON TEXT names specific classes OR attributes/methods, copy those names EXACTLY into attributes/methods arrays (UML visibility prefix + type). Example: narration says "make, model, and year" → attributes ["- make: String","- model: String","- year: Integer"].
3. Do NOT invent different attribute names when the lesson already listed them.
4. x/y are hints only (server re-layouts). Keep rough non-overlapping guesses.
5. Assign revealBeat progressively across the lesson beat count.
6. For kind "class": fill classes + relationships; leave actors/messages empty.
7. For kind "sequence": fill actors + messages; leave classes/relationships empty.
8. inheritance: from=child, to=parent. Prefer 3–5 classes. Max 8.
9. Prefer short relationship labels ("extends", "drives") — not the word "inheritance" unless teaching that term.
10. JSON only.`;

export async function generateUmlDiagramPlan(input: {
  prompt: string;
  lessonTitle?: string;
  beatCount?: number;
  /** Full lesson narrations + summary so attributes match what the tutor says. */
  lessonText?: string;
}): Promise<UmlDiagramPlan> {
  const { client, model } = getClient();
  const beatCount = Math.max(3, Math.min(input.beatCount ?? 5, 10));
  const lessonText = (input.lessonText ?? "").trim();

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.15,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `User request: ${input.prompt}
Lesson title: ${input.lessonTitle ?? "(none)"}
Lesson has about ${beatCount} beats — assign revealBeat from 1..${beatCount}.

LESSON TEXT (attributes/methods in the diagram MUST match these when mentioned):
${lessonText.slice(0, 4000) || "(no lesson text — infer carefully from the user request)"}

Generate the FULL UML diagram JSON now (every class/relationship that will ever be shown).`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("Empty UML diagram plan");
  }

  const raw = extractJson(content);
  const parsed = umlDiagramPlanSchema.safeParse(normalizeUml(raw));
  if (!parsed.success) {
    throw new Error(
      `UML plan failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }

  let plan = sanitizePlan(parsed.data, beatCount);
  if (lessonText) {
    plan = pruneUmlToLessonMentions(plan, lessonText);
    plan = alignUmlWithLessonText(plan, lessonText);
  }
  plan = layoutUmlClassPlan(plan);
  return plan;
}

function normalizeUml(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  return {
    ...obj,
    classes: Array.isArray(obj.classes) ? obj.classes : [],
    relationships: Array.isArray(obj.relationships) ? obj.relationships : [],
    actors: Array.isArray(obj.actors) ? obj.actors : [],
    messages: Array.isArray(obj.messages) ? obj.messages : [],
  };
}

function sanitizePlan(plan: UmlDiagramPlan, beatCount: number): UmlDiagramPlan {
  const clampBeat = (n: number) => Math.max(1, Math.min(beatCount, n));

  if (plan.kind === "class") {
    const classIds = new Set(plan.classes.map((c) => c.id));
    return {
      ...plan,
      actors: [],
      messages: [],
      classes: plan.classes.map((c) => ({
        ...c,
        revealBeat: clampBeat(c.revealBeat),
        attributes: c.attributes.slice(0, 4),
        methods: c.methods.slice(0, 4),
      })),
      relationships: plan.relationships
        .filter((r) => classIds.has(r.from) && classIds.has(r.to))
        .map((r) => ({
          ...r,
          revealBeat: clampBeat(r.revealBeat),
          label:
            r.label === "inheritance"
              ? "extends"
              : r.label?.slice(0, 28),
        })),
    };
  }

  const actorIds = new Set(plan.actors.map((a) => a.id));
  return {
    ...plan,
    classes: [],
    relationships: [],
    actors: plan.actors.map((a) => ({
      ...a,
      revealBeat: clampBeat(a.revealBeat),
    })),
    messages: plan.messages
      .filter((m) => actorIds.has(m.from) && actorIds.has(m.to))
      .map((m) => ({ ...m, revealBeat: clampBeat(m.revealBeat) })),
  };
}

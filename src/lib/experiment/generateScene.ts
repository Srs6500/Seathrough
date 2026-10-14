import OpenAI from "openai";
import { getLlmConfig } from "@/lib/env";
import {
  coerceLesson,
  simpleShapeLesson,
  type ExperimentFollowup,
  type ExperimentLesson,
} from "@/lib/experiment/scene";
import { graphFromPrompt, overlayPromptGraph, mentionsSecantAndTangent } from "@/lib/experiment/graph";
import {
  buildPhysicsTutorContext,
  formatPhysicsContextBlock,
} from "@/lib/physics-tutor/context";
import {
  attachPhysicsDiagramToLesson,
  summarizePhysicsRag,
} from "@/lib/physics-tutor/attach";
import { physicsCorpusStats } from "@/lib/physics-tutor/retrieve";

export type ExperimentLessonMode = "tutor" | "physics";

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getDrawingClient() {
  const openaiKey = optionalEnv("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      client: new OpenAI({ apiKey: openaiKey }),
      model: optionalEnv("OPENAI_MODEL") ?? "gpt-4.1",
    };
  }
  const cfg = getLlmConfig();
  return {
    client: new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    }),
    model: cfg.model,
  };
}

/**
 * Repair near-miss JSON: raw newlines in strings, trailing commas, and invalid
 * backslash escapes (models often emit TeX like \frac / \varepsilon inside "say").
 */
function repairJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        out += char;
        continue;
      }
      if (char === "\\") {
        const next = text[i + 1];
        if (next && "\"\\/bfnrtu".includes(next)) {
          escaped = true;
          out += char;
        } else {
          // Invalid JSON escape (often TeX) → keep as a literal backslash.
          out += "\\\\";
        }
        continue;
      }
      if (char === '"') inString = false;
      else if (char === "\n") {
        out += "\\n";
        continue;
      } else if (char === "\r") {
        continue;
      } else if (char === "\t") {
        out += "\\t";
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }
    out += char;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function parseLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(repairJson(text));
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseLenient(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return parseLenient(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return parseLenient(trimmed.slice(start, end + 1));
  }
  throw new Error("Model did not return JSON");
}

const SYSTEM = `You are a tutor at a whiteboard. The user asked a QUESTION.
Write a short spoken SCRIPT and DRAW a real diagram of the thing — not a single labeled box.

Return ONLY valid JSON:
{
  "title": "short title",
  "question": "the user's question, shortened",
  "beats": [
    {
      "say": "1–3 spoken sentences.",
      "example": "optional tiny code or data snippet",
      "shapes": [ /* shapes to add on THIS beat */ ],
      "check": { "ask": "one question about THIS step", "expect": "the idea, not the title" }
    }
  ]
}

Use 3–5 beats. Teach in order: start from the question, add one new idea per beat, then takeaway.
Never rewind to a more basic definition after you already used the idea (do not define “what a function is” in the middle of derivatives).
Never put stage directions in "say" (“Look at the board”, “Draw a line through (2,3) and (5,11)”). "say" is only explanation.

Pick a visual genre:
B) PROCESS / CONCEPT — OOP, classes, objects, recursion, algorithms, cycles.
   Separate boxes with arrows. Do not overlap. Never stack letters inside a skinny ellipse.
   Class vs object: two rectangles side by side (Class | Instance), field rows inside none —
   list fields as their own rectangles UNDER the class box with ≥40px gaps.
   If you use a car metaphor: body rectangle, engine rectangle to the LEFT, two CIRCLES for
   wheels UNDER the body. Names are callouts, not text inside the wheels.

A) STRUCTURE DIAGRAM — organs, body parts, machines, cells, plants, Earth layers, engines, computers, atoms, maps, volcanoes, vehicles.
   Build ONE figure in the center from touching/overlapping geo shapes that share cluster:"<name>".
   Parts use short or empty labels. Put the real names as callouts around the figure, each pointing at a part.
   Do not use this genre for Java/Python class or OOP lessons.
C) GEOMETRY — Pythagorean theorem, similar triangles, trig.
   NEVER use geo:"triangle" for a right triangle. That shape is isosceles.
   Use geo:"right-triangle" (right angle at the bottom-left, with a square corner).
   Put side labels a, b, c as callouts: a on the bottom, b on the left, c on the hypotenuse.
D) GRAPHS — named formula or they asked to graph/plot it: plot THAT f(x).
   Do NOT draw axes with rectangles or fake point-dots.
   Put the plot as:
   "graph": { "title":"y = sin(x)", "expression":"sin(x)", "xLabel":"x", "yLabel":"y", "showTangent": true }
   NEVER invent y = x^2, x^4, or any stock curve just because the word “tangent” appeared.
   EXCEPTION — they asked the difference between a secant and a tangent (no f named):
   use an EXAMPLE plot with both lines:
   "graph": { "title":"Example: y = x^2", "expression":"x^2", "showTangent": true, "showSecant": true }
   Say it is an example. NEVER draw an ellipse/oval labeled “Curve”.

Example — "what is a derivative" (no formula named, not “secant vs tangent”):
- No graph. Teach with words and a tiny slope diagram of boxes/arrows if needed.
- Beat 1: A derivative is the slope of a curve at one point.
- Beat 2: A secant between a and a+h has slope (f(a+h)-f(a))/h.
- Beat 3: As h shrinks, that secant becomes the tangent; that slope is f'(a).
- NEVER define “a function is a rule”. NEVER invent a parabola.

Example — "difference between secant and tangent":
- graph.expression "x^2", showSecant true, showTangent true, title "Example: y = x^2".
- Beat 1: Here’s an example curve, y = x².
- Beat 2: A secant through A and B cuts the curve at two points.
- Beat 3: A tangent at A touches at one point and matches the slope there.

Example — "derivative of sin(x)" or "graph y = sin(x)":
- graph.expression MUST be "sin(x)". showTangent true for derivatives.

Shape types:
1) geo { "id":"lv", "type":"geo", "geo":"ellipse", "x":280, "y":220, "w":150, "h":170,
         "label":"LV", "color":"red", "fill":"semi", "cluster":"heart", "role":"part" }
   geo: rectangle, ellipse, oval, triangle, right-triangle, diamond, pentagon, hexagon, cloud, heart,
        trapezoid, arrow-right, arrow-left, arrow-up, arrow-down
2) callout { "id":"lv_name", "type":"callout", "text":"Left ventricle", "to":"lv", "side":"left" }
3) text { "id":"t1", "type":"text", "x":300, "y":40, "text":"The heart", "role":"title" }
4) note { "id":"n1", "type":"note", "x":760, "y":80, "text":"pumps blood", "color":"yellow" }
5) arrow { "id":"a1", "type":"arrow", "from":"ra", "to":"rv", "label":"blood", "color":"blue" }

Colors: black, grey, blue, light-blue, yellow, orange, green, light-green, red, light-red, violet, light-violet, white
Fills: none, semi, solid, pattern
Sides: left, right, top, bottom

Example — "parts of the heart" (genre A):
- Beat 1: Title "The heart". Two overlapping ellipses cluster heart: LV (red, left) and RV (light-blue, right).
- Beat 2: Smaller ellipses on top: LA (left, light-red) and RA (right, blue). Callouts for the ventricles.
- Beat 3: arrow-up aorta from LV, arrow-down vena cava into RA. Callouts for atria, aorta, vena cava.
- Beat 4: Takeaway — left/red side sends blood to the body, right/blue side to the lungs.

Same pattern for a cell, volcano, atom, or computer: one clustered figure + callouts naming each part.

Example — "Pythagorean theorem" (genre C):
- One geo "right-triangle" cluster:"tri", fill none, w 280, h 210. Callouts a (bottom), b (left), c (hypotenuse). Note: a² + b² = c².

Rules:
- Never explain a physical thing as one lonely box. Draw its parts.
- Concept boxes (genre B) stay separate with ≥40px gaps. NEVER overlap boxes, callouts, or wheel labels.
- A class/object diagram is always genre B: no overlapping “car” blobs, no vertical letter-stacking.
- Unique ids. Callouts/arrows only to ids that already exist (this beat or earlier).
- Spoken "say" is the right-hand script. Diagram part labels stay 1–8 characters.
- Put code in one rectangle using real JSON line breaks, never the two characters \\n.
- A check is optional. Add "check" only on the one step a student could mix up: a rule, a cause, a comparison, or a definition they might reverse.
  Do not check a beat that only names parts, draws the picture, or restates the title.
  Most lessons get one check, on that step. A short visual explanation can have none.
  Recursion example: "check": { "ask": "What stops a recursive function?", "expect": "the base case" }
  Derivative example: "check": { "ask": "What does a derivative measure at a point?", "expect": "the slope of the tangent" }
  NEVER use "in your own words, what did that last step mean?".
  NEVER put the check question in "say". NEVER repeat the same "say" on two beats.
- When talking about a drawn part, set "highlight": ["shape-id"].
- For graphs: named f(x) or graph/plot → that expression. Secant vs tangent with no f → example y=x^2 with showSecant and showTangent. Never an oval labeled Curve.
  If they asked about sin(x), expression is "sin(x)". Never invent x^2 or x^4 unless this is the secant/tangent example.
  NEVER fake a coordinate plane with geo rectangles.
- JSON only.`;

function readFailedGeneration(error: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): string | null => {
    if (!value || depth > 6 || seen.has(value)) return null;
    if (typeof value !== "object") return null;
    seen.add(value);
    const rec = value as Record<string, unknown>;
    if (typeof rec.failed_generation === "string" && rec.failed_generation.trim()) {
      return rec.failed_generation;
    }
    for (const nested of [rec.error, rec.cause, rec.body, rec.data]) {
      const found = walk(nested, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(error, 0);
}

async function requestLesson(
  client: OpenAI,
  model: string,
  user: string,
  useJsonObject = true,
  systemContent: string = SYSTEM,
): Promise<ExperimentLesson> {
  let content = "";
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 4096,
      ...(useJsonObject
        ? { response_format: { type: "json_object" as const } }
        : {}),
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: user },
      ],
    });
    content = completion.choices[0]?.message?.content ?? "";
  } catch (error) {
    const recovered = readFailedGeneration(error);
    if (recovered) {
      try {
        return coerceLesson(extractJson(recovered));
      } catch {
        /* fall through */
      }
    }
    throw error;
  }
  if (!content.trim()) {
    throw new Error("empty model response");
  }
  try {
    return coerceLesson(extractJson(content));
  } catch (error) {
    console.warn(
      "[experiment-draw] lesson parse failed",
      error instanceof Error ? error.message : error,
      content.slice(0, 500),
    );
    throw error;
  }
}

function stampPromptGraph(
  lesson: ExperimentLesson,
  prompt: string,
): ExperimentLesson {
  if (!lesson.question) lesson.question = prompt.slice(0, 160);
  if (!lesson.beats.length) return lesson;
  const host =
    lesson.beats.find((beat) => beat.graph) ?? lesson.beats[0]!;
  host.graph = overlayPromptGraph(host.graph, prompt);
  return lesson;
}

export async function generateExperimentLesson(
  prompt: string,
  options?: { mode?: ExperimentLessonMode },
): Promise<ExperimentLesson> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Prompt is required");
  if (trimmed.length > 800) {
    throw new Error("Prompt is too long (max 800 characters)");
  }

  const physics = options?.mode === "physics";

  // Coding demos only for generic tutor — physics always plans a real lesson.
  if (
    !physics &&
    !graphFromPrompt(trimmed) &&
    !mentionsSecantAndTangent(trimmed)
  ) {
    const simple = simpleShapeLesson(trimmed);
    if (simple) return simple;
  }

  const { client, model } = getDrawingClient();
  const physicsCtx = physics ? buildPhysicsTutorContext(trimmed) : null;
  const physicsBlock = physicsCtx
    ? `\n\n${formatPhysicsContextBlock(physicsCtx)}`
    : "";
  const systemContent = physics
    ? `${SYSTEM}

You are teaching high-school physics on this whiteboard. Follow the PHYSICS MODE block in the user message. Keep Smart-tutor beat structure. Ground spoken beats in RETRIEVED CONTEXT.`
    : SYSTEM;
  const ask = `Question:\n${trimmed}\n\nWrite the teaching script and draw the example.${physicsBlock}`;

  const finish = (lesson: ExperimentLesson): ExperimentLesson => {
    let next = stampPromptGraph(lesson, trimmed);
    if (physicsCtx) {
      next = attachPhysicsDiagramToLesson(next, physicsCtx);
      const rag = summarizePhysicsRag(physicsCtx, physicsCorpusStats());
      next.rag = {
        corpusTotal: rag.corpus.total,
        chunks: rag.chunks,
        diagrams: rag.diagrams,
      };
      console.info("[physics-rag]", {
        prompt: trimmed.slice(0, 80),
        corpus: rag.corpus,
        hits: rag.chunks.map((c) => `${c.source}:${c.id}:${c.score}`),
        diagrams: rag.diagrams.map((d) => d.filename),
      });
    }
    return next;
  };

  try {
    return finish(await requestLesson(client, model, ask, true, systemContent));
  } catch (firstError) {
    console.warn(
      "[experiment-draw] first lesson attempt failed",
      firstError instanceof Error ? firstError.message : firstError,
    );
    try {
      const reason =
        firstError instanceof Error ? firstError.message : "invalid lesson";
      return finish(
        await requestLesson(
          client,
          model,
          `${ask}

Previous JSON failed (${reason}). Return 4 beats. If the topic is a physical thing, draw a clustered figure with callouts naming each part. If it is a graph, return graph.expression and no fake axes.`,
          false,
          systemContent,
        ),
      );
    } catch {
      throw new Error("Could not explain that. Try another question.");
    }
  }
}

const FOLLOWUP_SYSTEM = `You are a whiteboard tutor reacting to a student's answer.
Return ONLY JSON:
{
  "verdict": "continue" | "simplify" | "revisit",
  "say": "1 spoken sentence reacting to the answer",
  "beats": [ { "say":"...", "shapes":[], "highlight":[] } ]
}

verdict:
- continue: they got the idea, even in their own words. beats must be empty.
- simplify: they were lost. 2 short beats, easier example, draw it. Do not repeat the previous sentence.
- revisit: close but incomplete. 2 beats that redraw/highlight the missed part. Do not repeat the previous sentence.

If they explained the concept correctly, continue. Do not require them to repeat the topic title. Never say the short phrase is just the title.

Stay on the SAME topic as the title. If the lesson is derivatives, reteach secant → tangent → slope, never switch to drawing a random line through two points.

If you reteach (simplify or revisit), the last new beat MUST include a check that tests the idea you just re-explained.
Never use "Look at the board" or "Draw a line through…" as spoken script.

Use the same shape schema (geo, callout, text, note, arrow, highlight). JSON only.`;

export async function generateExperimentFollowup(input: {
  topic: string;
  title: string;
  ask: string;
  expect: string;
  answer: string;
  lastSay: string;
  mode?: ExperimentLessonMode;
}): Promise<ExperimentFollowup> {
  const { client, model } = getDrawingClient();
  const physics = input.mode === "physics";
  const user = `Topic: ${input.topic}
Title: ${input.title}
Tutor just said: ${input.lastSay}
Check question: ${input.ask}
Expected: ${input.expect}
Student answered: ${input.answer}

Choose continue, simplify, or revisit and draw if needed.
If their answer captures the idea, continue even if the wording differs.${
    physics
      ? "\nStay in high-school physics. Prefer field-line sketches if you reteach."
      : ""
  }`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: physics
          ? `${FOLLOWUP_SYSTEM}\nPhysics follow-up: keep electrostatics ideas; do not switch to unrelated topics.`
          : FOLLOWUP_SYSTEM,
      },
      { role: "user", content: user },
    ],
  });
  const content = completion.choices[0]?.message?.content ?? "";
  let raw: unknown;
  try {
    raw = extractJson(content);
  } catch (error) {
    const recovered = readFailedGeneration(error);
    raw = recovered ? extractJson(recovered) : null;
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Could not explain that. Try another question.");
  }
  const obj = raw as Record<string, unknown>;
  const verdictRaw = String(obj.verdict ?? obj.action ?? "revisit")
    .trim()
    .toLowerCase();
  const verdict: ExperimentFollowup["verdict"] =
    verdictRaw === "continue" || verdictRaw === "simplify"
      ? verdictRaw
      : "revisit";
  const say = String(obj.say ?? obj.reply ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  const rawBeats = Array.isArray(obj.beats) ? obj.beats : [];
  let lesson: ExperimentLesson = {
    title: input.title,
    beats: [],
  };
  if (rawBeats.length && verdict !== "continue") {
    lesson = coerceLesson({
      title: `${input.title} — follow-up`,
      beats: rawBeats,
    });
    lesson.beats = lesson.beats.filter((beat) => {
      const last = input.lastSay.trim().toLowerCase();
      const next = beat.say.trim().toLowerCase();
      return next.length > 0 && next !== last;
    });
  }
  return {
    verdict,
    say:
      say ||
      (verdict === "continue"
        ? "That's it. Let's keep going."
        : "Let's look at that again."),
    lesson,
  };
}

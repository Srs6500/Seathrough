import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import {
  boardScriptSchema,
  visualAnalysisSchema,
  type BoardScript,
} from "@/lib/schemas/boardScript";
import {
  hasConcreteProblem,
  makeTopicKey,
} from "@/lib/visuals/library/topicKey";
import {
  isIntegralAreaTopic,
  isLimitGraphTopic,
  isMatrixMultiplyTopic,
} from "@/lib/visuals/library/topicMatch";
import type { VisualPlan } from "@/lib/visuals/types";

/** In-flight / recent LLM scripts so concurrent beats share one analysis */
const scriptCache = new Map<string, Promise<VisualPlan | null>>();

/**
 * Build a progressive pen board for catalog misses.
 * Heuristics first (fast), else LLM analysis on-the-go, then generic fallback.
 */
export async function buildBoardScriptPlan(input: {
  prompt: string;
  conceptKey?: string;
  cognitiveType?: string;
  highlight?: string;
}): Promise<VisualPlan | null> {
  const heuristic = peekHeuristicBoardScript(input.prompt, input.conceptKey);
  if (heuristic) return heuristic;

  const cacheKey = makeTopicKey({
    prompt: input.prompt,
    conceptKey: input.conceptKey,
  });

  const existing = scriptCache.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const analyzed = await analyzeVisualForBoard(input);
      if (analyzed) return analyzed;
    } catch {
      // fall through
    }
    return genericTeachingScript(input);
  })();

  scriptCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch {
    scriptCache.delete(cacheKey);
    return genericTeachingScript(input);
  }
}

/** Sync heuristic lookup — used to prefer known pen lessons over stale cache. */
export function peekHeuristicBoardScript(
  prompt: string,
  conceptKey?: string,
): VisualPlan | null {
  return heuristicBoardScript(prompt, conceptKey);
}

/** True when a cached/routed plan is too weak to keep (concept sticker). */
export function isWeakVisualPlan(plan: VisualPlan): boolean {
  if (plan.renderer === "jsxgraph") {
    return !plan.topicId || !plan.topicParams;
  }
  if (plan.renderer === "board_script") {
    return !plan.boardScript?.steps?.length;
  }
  if (plan.renderer === "rough") {
    return !plan.sceneRecipe || plan.sceneRecipe.kind === "concept";
  }
  return false;
}

function heuristicBoardScript(
  prompt: string,
  conceptKey?: string,
): VisualPlan | null {
  const blob = `${prompt} ${conceptKey ?? ""}`.toLowerCase();

  const quadratic = matchQuadraticSolve(blob);
  if (quadratic) {
    return quadratic;
  }

  const bigBang = matchBigBang(blob);
  if (bigBang) {
    return bigBang;
  }

  if (
    /\bdivid(e|ing|es)?\b/.test(blob) &&
    /\bfraction\b/.test(blob)
  ) {
    return {
      renderer: "board_script",
      formula: "a \\div \\frac{1}{b} = a \\times b",
      boardScript: {
        title: "Dividing by a fraction",
        misconception: "Division always makes a number smaller",
        steps: [
          { type: "write", id: "e1", text: "4 ÷ 1/2", style: "equation" },
          { type: "note", text: "How many halves fit inside 4?" },
          { type: "pause", ms: 350 },
          { type: "arrow", label: "use reciprocal" },
          { type: "write", id: "e2", text: "4 × 2/1", style: "equation" },
          { type: "arrow", label: "multiply" },
          { type: "write", id: "e3", text: "8", style: "emphasis" },
          { type: "box", targetId: "e3" },
          {
            type: "note",
            text: "÷ fraction = × reciprocal → answer gets bigger",
          },
        ],
      },
      actions: [],
    };
  }

  if (/\barea\b/.test(blob) && /\bperimeter\b/.test(blob)) {
    return {
      renderer: "board_script",
      formula: "A = L \\times W \\quad P = 2(L+W)",
      boardScript: {
        title: "Area vs perimeter",
        misconception: "Area and perimeter are the same measurement",
        steps: [
          { type: "write", id: "s1", text: "Rectangle 3 × 4", style: "equation" },
          { type: "note", text: "Picture a 3-by-4 rectangle" },
          { type: "arrow", label: "inside" },
          {
            type: "write",
            id: "a1",
            text: "Area = 3 × 4 = 12",
            style: "equation",
          },
          { type: "note", text: "tiles covering the inside" },
          { type: "arrow", label: "around" },
          {
            type: "write",
            id: "p1",
            text: "Perimeter = 3+4+3+4 = 14",
            style: "equation",
          },
          { type: "note", text: "fence around the outside" },
          { type: "box", targetId: "a1" },
          {
            type: "note",
            text: "Area = space inside · Perimeter = distance around",
          },
        ],
      },
      actions: [],
    };
  }

  if (isIntegralAreaTopic(prompt, conceptKey)) {
    return {
      renderer: "board_script",
      formula: "\\int_a^b f(x) dx",
      boardScript: {
        title: "Signed area from a to b",
        misconception: "A definite integral always adds ordinary area",
        steps: [
          {
            type: "write",
            id: "e1",
            text: "A definite integral measures signed area.",
            style: "plain",
            beat: 1,
          },
          {
            type: "note",
            text: "Look between the curve and x-axis, from x = a to x = b.",
            beat: 1,
          },
          {
            type: "write",
            id: "e2",
            text: "The curve is y = f(x).",
            style: "equation",
            beat: 2,
          },
          {
            type: "note",
            text: "Height at each x is the value of the function.",
            beat: 2,
          },
          {
            type: "write",
            id: "e3",
            text: "Slice that region into thin rectangles.",
            style: "plain",
            beat: 3,
          },
          {
            type: "note",
            text: "Each slice contributes signed area f(x) times a little dx.",
            beat: 3,
          },
          {
            type: "write",
            id: "e4",
            text: "Above the x-axis adds; below the x-axis subtracts.",
            style: "plain",
            beat: 4,
          },
          {
            type: "note",
            text: "Thinner slices approach the signed-area sum.",
            beat: 4,
          },
          {
            type: "write",
            id: "e5",
            text: "integral from a to b of f(x) dx = signed area",
            style: "emphasis",
            beat: 5,
          },
          { type: "box", targetId: "e5", beat: 5 },
        ],
      },
      actions: [],
    };
  }

  if (isMatrixMultiplyTopic(prompt, conceptKey)) {
    return {
      renderer: "board_script",
      formula: "(AB)_{ij} = row_i \\cdot col_j",
      boardScript: {
        title: "Matrix multiplication",
        misconception: "You multiply matching cells, like 1×5, 2×6, 3×7, 4×8",
        steps: [
          {
            type: "write",
            id: "m1",
            text: "Two matrices. A on the left, B on the right.",
            style: "plain",
            beat: 1,
          },
          {
            type: "note",
            text: "Inner sizes match (2 and 2), so they can multiply.",
            beat: 1,
          },
          {
            type: "write",
            id: "m2",
            text: "Each entry of C is one row of A dotted with one column of B.",
            style: "plain",
            beat: 2,
          },
          {
            type: "note",
            text: "C has A's rows and B's columns.",
            beat: 2,
          },
          {
            type: "write",
            id: "m3",
            text: "Top-left: 1×5 + 2×7 = 19",
            style: "equation",
            beat: 3,
          },
          {
            type: "note",
            text: "Row 1 of A against column 1 of B.",
            beat: 3,
          },
          {
            type: "write",
            id: "m4",
            text: "Top-right: 1×6 + 2×8 = 22",
            style: "equation",
            beat: 4,
          },
          {
            type: "write",
            id: "m5",
            text: "Bottom row the same way: 43 and 50.",
            style: "emphasis",
            beat: 5,
          },
          { type: "box", targetId: "m5", beat: 5 },
          {
            type: "note",
            text: "Never multiply cell-by-cell. It's always row · column.",
            beat: 5,
          },
        ],
      },
      actions: [],
    };
  }

  if (isLimitGraphTopic(prompt, conceptKey)) {
    return {
      renderer: "board_script",
      formula: "\\lim_{x \\to a} f(x) = L",
      boardScript: {
        title: "Limits on a graph",
        misconception: "The limit is just plugging in x = a",
        steps: [
          {
            type: "write",
            id: "e1",
            text: "A limit asks what y does as x gets close to a.",
            style: "plain",
            beat: 1,
          },
          {
            type: "note",
            text: "Watch the graph — not a plug-in formula.",
            beat: 1,
          },
          {
            type: "write",
            id: "e2",
            text: "Draw y = f(x). There can be a hole at x = a.",
            style: "equation",
            beat: 2,
          },
          {
            type: "note",
            text: "f(a) might be missing or a different height.",
            beat: 2,
          },
          {
            type: "write",
            id: "e3",
            text: "From the left, the curve heads toward height L.",
            style: "plain",
            beat: 3,
          },
          {
            type: "write",
            id: "e4",
            text: "From the right, it heads toward the same L.",
            style: "plain",
            beat: 4,
          },
          {
            type: "write",
            id: "e5",
            text: "lim x→a of f(x) = L",
            style: "emphasis",
            beat: 5,
          },
          { type: "box", targetId: "e5", beat: 5 },
          {
            type: "note",
            text: "The limit is the height we approach, not the plugged-in point.",
            beat: 5,
          },
        ],
      },
      actions: [],
    };
  }

  if (/\bderivative\b/.test(blob)) {
    return {
      renderer: "board_script",
      formula: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}",
      boardScript: {
        title: "What a derivative means",
        misconception: "Derivative is just a formula to memorize",
        steps: [
          { type: "write", id: "e1", text: "f(x) as x changes", style: "plain", beat: 1 },
          { type: "arrow", label: "ask", beat: 1 },
          {
            type: "write",
            id: "e2",
            text: "How fast is f changing?",
            style: "emphasis",
            beat: 2,
          },
          { type: "note", text: "That rate is the derivative", beat: 2 },
          { type: "arrow", label: "geometry", beat: 3 },
          {
            type: "write",
            id: "e3",
            text: "slope of the tangent line",
            style: "equation",
            beat: 3,
          },
          { type: "box", targetId: "e3", beat: 4 },
          {
            type: "note",
            text: "f'(x) = instantaneous rate of change",
            beat: 4,
          },
        ],
      },
      actions: [],
    };
  }

  if (
    /0\.9{3,}|0\.9+\.\.\.|0\.9+…/.test(blob) ||
    (/0\.999/.test(blob) && /\b(1|one|equal)\b/.test(blob))
  ) {
    return {
      renderer: "board_script",
      formula: "0.\\overline{9} = 1",
      boardScript: {
        title: "Why 0.999... = 1",
        misconception: "An infinite string of 9s must stay less than 1",
        steps: [
          { type: "write", id: "q1", text: "0.999... = 1 ?", style: "equation", beat: 1 },
          { type: "note", text: "Feels wrong — define the dots", beat: 1 },
          {
            type: "note",
            text: "0.999... means 9s forever",
            beat: 2,
          },
          {
            type: "write",
            id: "s1",
            text: "9/10 + 9/100 + 9/1000 + …",
            style: "equation",
            beat: 3,
          },
          { type: "note", text: "infinite geometric series", beat: 3 },
          {
            type: "write",
            id: "s2",
            text: "S = a / (1 − r)",
            style: "equation",
            beat: 4,
          },
          { type: "note", text: "a = 9/10 · r = 1/10", beat: 4 },
          {
            type: "write",
            id: "s3",
            text: "S = (9/10)/(9/10) = 1",
            style: "emphasis",
            beat: 5,
          },
          { type: "box", targetId: "s3", beat: 5 },
          {
            type: "note",
            text: "So 0.999... equals 1",
            beat: 6,
          },
        ],
      },
      actions: [],
    };
  }

  if (
    /\b(probability|coin flips?|two coins|sample space)\b/.test(blob) ||
    (/\bcoin\b/.test(blob) && /\b(flip|flips|heads|tails)\b/.test(blob))
  ) {
    return {
      renderer: "board_script",
      formula: "P(E) = \\frac{\\text{favorable}}{\\text{total}}",
      boardScript: {
        title: "Two coin flips",
        misconception: "HT and TH are the same outcome",
        steps: [
          {
            type: "write",
            id: "c1",
            text: "Coin A · Coin B",
            style: "plain",
            beat: 1,
          },
          { type: "note", text: "Flip both once", beat: 1 },
          {
            type: "write",
            id: "c2",
            text: "HH  HT  TH  TT",
            style: "equation",
            beat: 2,
          },
          { type: "note", text: "4 equally likely outcomes", beat: 2 },
          {
            type: "write",
            id: "c3",
            text: "P = favorable / 4",
            style: "equation",
            beat: 3,
          },
          {
            type: "note",
            text: "At least one H → HH, HT, TH",
            beat: 4,
          },
          {
            type: "write",
            id: "c4",
            text: "P(≥1 head) = 3/4",
            style: "emphasis",
            beat: 4,
          },
          { type: "box", targetId: "c4", beat: 5 },
          {
            type: "note",
            text: "List the sample space, then count",
            beat: 5,
          },
        ],
      },
      actions: [],
    };
  }

  if (/\breciprocal\b/.test(blob)) {
    return {
      renderer: "board_script",
      formula: "\\frac{a}{b} \\times \\frac{b}{a} = 1",
      boardScript: {
        title: "Reciprocal",
        steps: [
          { type: "write", id: "e1", text: "2/3", style: "equation" },
          { type: "arrow", label: "flip" },
          { type: "write", id: "e2", text: "3/2", style: "equation" },
          { type: "note", text: "Product is 1 — these are reciprocals" },
        ],
      },
      actions: [],
    };
  }

  if (
    /\b(multiply|multiplication)\b/.test(blob) &&
    /\bfraction\b/.test(blob)
  ) {
    return {
      renderer: "board_script",
      formula: "\\frac{a}{b} \\times \\frac{c}{d} = \\frac{ac}{bd}",
      boardScript: {
        title: "Multiply fractions",
        steps: [
          { type: "write", id: "e1", text: "1/2 × 3/4", style: "equation" },
          { type: "arrow", label: "multiply tops & bottoms" },
          { type: "write", id: "e2", text: "3/8", style: "emphasis" },
          { type: "box", targetId: "e2" },
        ],
      },
      actions: [],
    };
  }

  return null;
}

async function analyzeVisualForBoard(input: {
  prompt: string;
  conceptKey?: string;
  cognitiveType?: string;
  highlight?: string;
}): Promise<VisualPlan | null> {
  const config = getLlmConfig();
  const client = getTrackedOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You plan a short TEACHER WHITEBOARD script (pen writing), not a finished diagram.

Return ONLY JSON matching:
{
  "teachingGoal": string,
  "misconception": string (optional),
  "visualStrategy": "equation_transform" | "definition_steps" | "compare" | "process" | "example_work",
  "example": { "expression": string, "result": string } (optional),
  "boardScript": {
    "title": string,
    "misconception": string (optional),
    "steps": [
      { "type": "write", "id": "e1", "text": "...", "style": "plain"|"equation"|"emphasis" }
      | { "type": "arrow", "label": "..." }
      | { "type": "box", "targetId": "e1" }
      | { "type": "cross_out", "targetId": "e1" }
      | { "type": "note", "text": "..." }
      | { "type": "pause", "ms": 300 }
    ]
  }
}

Rules:
- Write COMPLETE sentences (or full short equations) — never keyword fragments like "Big Bang" alone.
- Prefer: "The universe began from a hot, dense singularity." over "singularity".
- If the question already contains a concrete problem (an equation or arithmetic), work THAT EXACT problem on the board — same numbers, same variables. Never substitute your own example.
- Only invent a concrete mini-example when the question is abstract and has no numbers of its own; for science, narrate the process in full sentences.
- 4–8 steps. Progressive pen writing. One idea per step.
- Tag each step with "beat": 1, 2, 3... matching the teaching order (beat 1 = intro, later beats deepen).
- Use arrows ONLY between two write steps for math transforms or process flow (write → arrow → write).
- Arrow labels must be short connectors only: "then", "so", "therefore", "becomes", "flip" — NEVER content words like "unless" or "inertia".
- For definitions (e.g. inertia): use write + note + write + box — do NOT insert decorative arrows.
- No pixel coordinates. No SVG/JS code.
- write text max 100 chars (complete sentence). note max 140 chars.
- MATH ON THE BOARD: use plain readable fractions and operators only — "1/2 x + 3/2 (x+1) = 5", "×", "÷". NEVER put LaTeX in write/note text (no \\frac, no $, no \\times).
- Put display LaTeX only in example.expression if needed; board write steps stay plain.
- For definitions: full-sentence definition → why it matters → tiny concrete example → boxed takeaway.
- For integrals / area under a curve: write that same story (curve, slices, sum, integral). Do not switch to a different example.
- For limits as x approaches a number: write the graph story (curve, hole at a, left/right approach, lim = L).
- For compare questions: side A → side B → difference note.
- Address the misconception if one exists.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt: input.prompt,
          conceptKey: input.conceptKey,
          cognitiveType: input.cognitiveType,
          highlight: input.highlight,
          workThisExactProblem: hasConcreteProblem(input.prompt),
        }),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = visualAnalysisSchema.safeParse(normalizeAnalysis(json));
  if (!parsed.success) {
    const scriptOnly = boardScriptSchema.safeParse(
      (json as { boardScript?: unknown })?.boardScript,
    );
    if (!scriptOnly.success) return null;
    return planFromScript(scriptOnly.data, undefined);
  }

  const formula = guessFormula(parsed.data.boardScript, parsed.data.example);
  return planFromScript(parsed.data.boardScript, formula);
}

function genericTeachingScript(input: {
  prompt: string;
  conceptKey?: string;
  highlight?: string;
}): VisualPlan {
  const label =
    input.highlight?.trim().slice(0, 36) ||
    input.conceptKey?.trim().slice(0, 36) ||
    shortenPrompt(input.prompt);

  return {
    renderer: "board_script",
    boardScript: {
      title: label,
      steps: [
        { type: "write", id: "t1", text: label, style: "emphasis" },
        { type: "note", text: "Break it into a small example" },
        { type: "arrow", label: "then" },
        {
          type: "write",
          id: "t2",
          text: "check with a simple case",
          style: "plain",
        },
        { type: "box", targetId: "t2" },
      ],
    },
    actions: [],
  };
}

function planFromScript(
  boardScript: BoardScript,
  formula?: string,
): VisualPlan {
  return {
    renderer: "board_script",
    formula,
    boardScript: sanitizeScriptSteps(boardScript),
    actions: [],
  };
}

/** Drop orphan arrows before the script reaches the draw engine. */
function sanitizeScriptSteps(script: BoardScript): BoardScript {
  const raw = script.steps;
  const steps: BoardScript["steps"] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const step = raw[i]!;
    if (step.type !== "arrow") {
      steps.push(step);
      continue;
    }
    const label = (step.label ?? "").trim().toLowerCase();
    const connector =
      !label ||
      /^(then|so|next|therefore|thus|hence|because|becomes|means|gives|leads to|equals|flip|multiply|divide|use reciprocal|multiply tops & bottoms|ask|inside|around|geometry)$/i.test(
        label,
      ) ||
      /^(then|so|next|therefore)\b/.test(label);
    if (label && !connector) {
      if (label.split(/\s+/).length >= 3) {
        steps.push({
          type: "note",
          text: step.label!.slice(0, 160),
          beat: step.beat,
        });
      }
      continue;
    }
    const prevWrite = steps.some((s) => s.type === "write");
    const nextWrite = raw.slice(i + 1).some((s) => s.type === "write");
    if (prevWrite && nextWrite) steps.push(step);
  }
  return { ...script, steps: steps.length >= 2 ? steps : script.steps };
}

function normalizeAnalysis(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const obj = { ...(json as Record<string, unknown>) };
  const script = obj.boardScript;
  if (script && typeof script === "object") {
    const s = script as Record<string, unknown>;
    if (Array.isArray(s.steps)) {
      s.steps = s.steps.map((step, i) => {
        if (!step || typeof step !== "object") return step;
        const st = { ...(step as Record<string, unknown>) };
        if (st.type === "write" && st.style == null) st.style = "plain";
        if (st.type === "write" && st.id == null) st.id = `w${i + 1}`;
        return st;
      });
    }
    obj.boardScript = s;
  }
  return obj;
}

function guessFormula(
  script: BoardScript,
  example?: { expression?: string; result?: string },
): string | undefined {
  const writes = script.steps
    .filter((s) => s.type === "write")
    .map((s) => (s.type === "write" ? s.text : ""));
  const joined = writes.join(" ");
  if (/÷|\/|×|\*/.test(joined) || example?.expression) {
    // Prefer last equation-looking write as strip; KaTeX may fail on unicode — FormulaStrip handles throwOnError
    const last = [...writes].reverse().find((t) => /[÷×=\/]/.test(t));
    if (last) return last.replace(/÷/g, "\\div ").replace(/×/g, "\\times ");
  }
  return undefined;
}

function shortenPrompt(prompt: string): string {
  return (
    prompt
      .replace(
        /^(please\s+)?(explain|what is|what's|why does|why do|how does|how do)\s+/i,
        "",
      )
      .replace(/\?+$/, "")
      .trim()
      .slice(0, 40) || "idea"
  );
}

/** Solve / factor a quadratic like x²−5x+6=0 — never a random graph. */
function matchBigBang(blob: string): VisualPlan | null {
  if (
    !/\bbig\s*bang\b/.test(blob) &&
    !/\bsingularit(?:y|ies)\b/.test(blob) &&
    !/\borigin of the universe\b/.test(blob)
  ) {
    return null;
  }

  return {
    renderer: "board_script",
    boardScript: {
      title: "The Big Bang Theory",
      misconception: "Thinking it was an explosion in empty space",
      steps: [
        {
          type: "write",
          id: "bb1",
          text: "The Big Bang Theory explains how the universe began.",
          style: "emphasis",
          beat: 1,
        },
        {
          type: "write",
          id: "bb2",
          text: "Everything started from a hot, dense singularity.",
          style: "plain",
          beat: 2,
        },
        {
          type: "arrow",
          label: "then space itself grew",
          beat: 2,
        },
        {
          type: "write",
          id: "bb3",
          text: "That singularity expanded rapidly into the early universe.",
          style: "plain",
          beat: 3,
        },
        {
          type: "note",
          text: "Space itself stretched — matter rode along with it.",
          beat: 3,
        },
        {
          type: "write",
          id: "bb4",
          text: "As it expanded and cooled, atoms, stars, and galaxies formed.",
          style: "plain",
          beat: 4,
        },
        {
          type: "write",
          id: "bb5",
          text: "This all began about 13.8 billion years ago.",
          style: "emphasis",
          beat: 5,
        },
        { type: "box", targetId: "bb5", beat: 5 },
        {
          type: "note",
          text: "Evidence: cosmic microwave background and expanding galaxies.",
          beat: 5,
        },
      ],
    },
    actions: [],
  };
}

function matchQuadraticSolve(blob: string): VisualPlan | null {
  const compact = blob
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/²/g, "^2")
    .replace(/x\^\{2\}/g, "x^2")
    .replace(/x\*\*2/g, "x^2")
    .replace(/−/g, "-");

  const looksQuadratic =
    /x\^2/.test(compact) ||
    /\bquadratic\b/.test(blob) ||
    /ax\^2\+bx\+c/.test(compact);

  if (!looksQuadratic) return null;

  const teaching =
    /\b(solve|factor|teach|explain|understand|break\s*down|how\s+did|values?\s+of\s+a\s*,?\s*b|roots?|zeros?)\b/.test(
      blob,
    ) || /=0/.test(compact);

  if (!teaching) return null;

  // Specific popular example x² − 5x + 6 = 0
  if (/x\^2-5x\+6/.test(compact)) {
    return {
      renderer: "board_script",
      formula: "x^2 - 5x + 6 = 0",
      boardScript: {
        title: "Solve x² − 5x + 6 = 0",
        misconception: "Guessing roots without factoring",
        steps: [
          {
            type: "write",
            id: "q1",
            text: "x² − 5x + 6 = 0",
            style: "equation",
            beat: 1,
          },
          {
            type: "note",
            text: "Standard form: ax² + bx + c = 0",
            beat: 1,
          },
          {
            type: "write",
            id: "q2",
            text: "a = 1 · b = −5 · c = 6",
            style: "equation",
            beat: 2,
          },
          {
            type: "note",
            text: "Find two numbers: product = c, sum = b",
            beat: 2,
          },
          {
            type: "write",
            id: "q3",
            text: "−2 and −3  (because −2×−3=6, −2+(−3)=−5)",
            style: "plain",
            beat: 3,
          },
          {
            type: "write",
            id: "q4",
            text: "(x − 2)(x − 3) = 0",
            style: "equation",
            beat: 4,
          },
          {
            type: "write",
            id: "q5",
            text: "x = 2  or  x = 3",
            style: "emphasis",
            beat: 5,
          },
          { type: "box", targetId: "q5", beat: 5 },
          {
            type: "note",
            text: "Zero product: each factor can be 0",
            beat: 5,
          },
        ],
      },
      actions: [],
    };
  }

  // Generic quadratic factoring / identifying a,b,c
  return {
    renderer: "board_script",
    formula: "ax^2 + bx + c = 0",
    boardScript: {
      title: "Solve a quadratic",
      misconception: "a, b, c are random letters",
      steps: [
        {
          type: "write",
          id: "g1",
          text: "ax² + bx + c = 0",
          style: "equation",
          beat: 1,
        },
        {
          type: "note",
          text: "a = coeff of x² · b = coeff of x · c = constant",
          beat: 1,
        },
        {
          type: "write",
          id: "g2",
          text: "Try factoring: (x + p)(x + q) = 0",
          style: "equation",
          beat: 2,
        },
        {
          type: "note",
          text: "Need p·q = c and p+q = b (when a = 1)",
          beat: 2,
        },
        {
          type: "write",
          id: "g3",
          text: "Then x = −p or x = −q",
          style: "emphasis",
          beat: 3,
        },
        { type: "box", targetId: "g3", beat: 3 },
        {
          type: "note",
          text: "Or use the quadratic formula if it won’t factor",
          beat: 4,
        },
      ],
    },
    actions: [],
  };
}


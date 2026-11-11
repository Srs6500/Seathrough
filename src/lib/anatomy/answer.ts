import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import { anatomyModelAnswerSchema } from "@/lib/anatomy/schemas";
import {
  citationsForKnowledge,
  type AnatomyKnowledgeEntry,
} from "@/lib/anatomy/knowledge/shared";
import type {
  AnatomyAnswer,
  AnatomyAnimationMode,
  AnatomySceneId,
  AnatomyStructureId,
} from "@/lib/anatomy/types";
import {
  ANATOMY_ANIMATION_MODES,
  ANATOMY_STRUCTURE_IDS,
} from "@/lib/anatomy/types";
import {
  SCENE_MODE_SETS,
  STRUCTURE_BY_ID,
} from "@/lib/anatomy/registry";

function suggestedMode(
  entries: AnatomyKnowledgeEntry[],
  sceneId: AnatomySceneId,
): AnatomyAnimationMode {
  const ids = new Set(entries.map((entry) => entry.id));
  if (sceneId === "eye") {
    if (ids.has("accommodation")) return "accommodation";
    if (ids.has("pupil-reflex")) return "pupil-reflex";
    if (ids.has("photoreceptors") || ids.has("fovea")) return "photoreceptors";
    if (ids.has("visual-pathway") || ids.has("optic-nerve")) {
      return "neural-signal";
    }
    if (ids.has("light-path") || ids.has("inverted-image") || ids.has("cornea-refraction")) {
      return "light-path";
    }
    return "overview";
  }
  if (sceneId === "brain") {
    if (ids.has("motor-control")) return "motor-control";
    if (ids.has("sensory-processing")) return "sensory-processing";
    if (ids.has("brainstem-pathway")) return "neural-signal";
    return "overview";
  }
  if (sceneId === "kidney") {
    if (ids.has("filtration")) return "filtration";
    if (ids.has("reabsorption")) return "reabsorption";
    if (ids.has("urine-flow")) return "urine-flow";
    return "overview";
  }
  if (ids.has("gas-exchange")) return "gas-exchange";
  if (ids.has("ventilation")) return "ventilation";
  if (ids.has("cardiac-cycle") || ids.has("valves")) return "cardiac-cycle";
  if (ids.has("left-heart")) return "systemic-outflow";
  if (ids.has("complete-blood-route") || ids.has("pulmonary-circuit")) {
    return "pulmonary-circulation";
  }
  return "overview";
}

function normalizeStructure(value: unknown): AnatomyStructureId | null {
  const raw =
    typeof value === "object" && value && "id" in value
      ? (value as { id?: unknown }).id
      : value;
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if ((ANATOMY_STRUCTURE_IDS as readonly string[]).includes(key)) {
    return key as AnatomyStructureId;
  }
  const aliases: Record<string, AnatomyStructureId> = {
    "right-atria": "right-atrium",
    "left-atria": "left-atrium",
    "pulmonary-artery": "pulmonary-trunk",
    "pulmonary-arteries": "pulmonary-trunk",
    "pulmonary-vein": "right-pulmonary-veins",
    "pulmonary-veins": "right-pulmonary-veins",
    lungs: "right-lung",
    bronchus: "main-bronchi",
    bronchi: "main-bronchi",
    "vena-cava": "superior-vena-cava",
    rods: "photoreceptors",
    cones: "photoreceptors",
    "rods-and-cones": "photoreceptors",
    "optic-disc": "optic-nerve",
    "blind-spot": "optic-nerve",
    macula: "fovea",
    cortex: "visual-cortex",
    brain: "visual-cortex",
    "aqueous": "aqueous-humor",
    "vitreous-humor": "vitreous",
    "vitreous-body": "vitreous",
  };
  return aliases[key] ?? null;
}

export function revealForFocusedStructures(
  requestedReveal: number,
  structures: AnatomyStructureId[],
): number {
  return structures.reduce(
    (maximum, structure) =>
      Math.max(maximum, STRUCTURE_BY_ID[structure]?.reveal ?? 1),
    Math.max(1, Math.min(6, Math.round(requestedReveal))),
  );
}

function coerceMode(
  requested: string,
  fallback: AnatomyAnimationMode,
  sceneId: AnatomySceneId,
): AnatomyAnimationMode {
  if (!(ANATOMY_ANIMATION_MODES as readonly string[]).includes(requested)) {
    return fallback;
  }
  const mode = requested as AnatomyAnimationMode;
  if (
    !(SCENE_MODE_SETS[sceneId] as readonly AnatomyAnimationMode[]).includes(
      mode,
    )
  ) {
    return fallback;
  }
  return mode;
}

export function normalizeAnatomyModelAnswer(
  json: unknown,
  fallbackMode: AnatomyAnimationMode,
  sceneId: AnatomySceneId = "cardiopulmonary",
): unknown {
  if (!json || typeof json !== "object") return json;
  const outer = json as Record<string, unknown>;
  const value =
    outer.result && typeof outer.result === "object"
      ? (outer.result as Record<string, unknown>)
      : outer;
  const focusRaw =
    value.focusStructures ?? value.focus_structures ?? value.structures ?? [];
  const focusStructures = Array.isArray(focusRaw)
    ? focusRaw
        .map(normalizeStructure)
        .filter((structure): structure is AnatomyStructureId => Boolean(structure))
        .slice(0, 8)
    : [];
  const requestedMode =
    typeof (value.animationMode ?? value.animation_mode) === "string"
      ? String(value.animationMode ?? value.animation_mode)
      : fallbackMode;
  const animationMode = coerceMode(requestedMode, fallbackMode, sceneId);
  const rawReveal = Number(value.reveal ?? 6);

  return {
    answer:
      value.answer ??
      value.explanation ??
      value.response ??
      value.text ??
      "",
    focusStructures,
    animationMode,
    reveal: Number.isFinite(rawReveal)
      ? Math.max(1, Math.min(6, Math.round(rawReveal)))
      : 6,
    supported: value.supported !== false,
  };
}

const SYSTEM_BY_SCENE: Record<AnatomySceneId, string> = {
  cardiopulmonary: `You answer questions about the normal adult heart and lungs for an educational 3D app.
Use ONLY the supplied evidence. Do not add diagnoses, treatment advice, statistics, or unsupported mechanisms.
Explain direction and cause clearly. Correct common misconceptions directly.
If evidence is insufficient, set supported=false and say what the evidence cannot establish.
Return JSON only with:
{
  "answer": string,
  "focusStructures": string[],
  "animationMode": "overview" | "cardiac-cycle" | "pulmonary-circulation" | "systemic-outflow" | "ventilation" | "gas-exchange",
  "reveal": integer 1-6,
  "supported": boolean
}
focusStructures may use only structure IDs appearing in the evidence.`,
  eye: `You answer questions about normal adult eye anatomy and vision for an educational 3D app.
Use ONLY the supplied evidence. Do not add diagnoses, treatment advice, prescriptions, or unsupported mechanisms.
Explain the light path clearly. Emphasize that the retinal image is inverted and that upright perception is cortical, not a physical flip at the retina.
If evidence is insufficient, set supported=false and say what the evidence cannot establish.
Return JSON only with:
{
  "answer": string,
  "focusStructures": string[],
  "animationMode": "overview" | "light-path" | "accommodation" | "pupil-reflex" | "photoreceptors" | "neural-signal",
  "reveal": integer 1-6,
  "supported": boolean
}
focusStructures may use only structure IDs appearing in the evidence.`,
  brain: `You answer questions about normal adult brain anatomy and neural function for an educational 3D app.
Use ONLY the supplied evidence. Do not add diagnoses, treatment advice, behavioral claims, or unsupported mechanisms.
Explain pathways and regional functions clearly without implying that complex functions belong to only one isolated region.
If evidence is insufficient, set supported=false and say what the evidence cannot establish.
Return JSON only with:
{
  "answer": string,
  "focusStructures": string[],
  "animationMode": "overview" | "sensory-processing" | "motor-control" | "neural-signal",
  "reveal": integer 1-6,
  "supported": boolean
}
focusStructures may use only structure IDs appearing in the evidence.`,
  kidney: `You answer questions about normal adult kidney anatomy and renal physiology for an educational 3D app.
Use ONLY the supplied evidence. Do not add diagnoses, treatment advice, laboratory ranges, or unsupported mechanisms.
Clearly distinguish filtration, tubular reabsorption, secretion, and final urine flow.
If evidence is insufficient, set supported=false and say what the evidence cannot establish.
Return JSON only with:
{
  "answer": string,
  "focusStructures": string[],
  "animationMode": "overview" | "filtration" | "reabsorption" | "urine-flow",
  "reveal": integer 1-6,
  "supported": boolean
}
focusStructures may use only structure IDs appearing in the evidence.`,
};

const UNSUPPORTED_BY_SCENE: Record<AnatomySceneId, string> = {
  cardiopulmonary:
    "I do not have enough cardiopulmonary evidence in the reviewed source set to answer that question reliably. Try asking about normal heart chambers, valves, pulmonary blood flow, breathing, or alveolar gas exchange.",
  eye:
    "I do not have enough eye/vision evidence in the reviewed source set to answer that question reliably. Try asking about the light path, cornea, lens focus, pupil, retina, rods and cones, or how signals reach the brain.",
  brain:
    "I do not have enough brain evidence in the reviewed source set to answer that question reliably. Try asking about cerebral lobes, sensory pathways, motor control, the cerebellum, brainstem, or spinal cord.",
  kidney:
    "I do not have enough renal evidence in the reviewed source set to answer that question reliably. Try asking about filtration, nephrons, reabsorption, collecting ducts, urine flow, or renal blood vessels.",
};

export async function generateGroundedAnatomyAnswer(input: {
  question: string;
  selectedStructure?: AnatomyStructureId | null;
  entries: AnatomyKnowledgeEntry[];
  sceneId?: AnatomySceneId;
  signal?: AbortSignal;
}): Promise<AnatomyAnswer> {
  const sceneId = input.sceneId ?? "cardiopulmonary";
  const citations = citationsForKnowledge(input.entries);
  if (!input.entries.length) {
    return {
      answer: UNSUPPORTED_BY_SCENE[sceneId],
      citations: [],
      focusStructures: input.selectedStructure
        ? [input.selectedStructure]
        : [],
      animationMode: "overview",
      reveal: 6,
      supported: false,
    };
  }

  const config = getLlmConfig();
  const client = getTrackedOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const evidence = input.entries
    .map(
      (entry, index) =>
        `[E${index + 1}] ${entry.title}\nStructures: ${entry.structureIds.join(", ")}\n${entry.excerpt}`,
    )
    .join("\n\n");
  const mode = suggestedMode(input.entries, sceneId);
  const allowedModes = SCENE_MODE_SETS[sceneId].join(" | ");

  const completion = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: SYSTEM_BY_SCENE[sceneId],
        },
        {
          role: "user",
          content: [
            `Question: ${input.question}`,
            input.selectedStructure
              ? `Currently selected structure: ${input.selectedStructure}`
              : "",
            `Preferred visualization mode when appropriate: ${mode}`,
            `Allowed animationMode values: ${allowedModes}`,
            `Evidence:\n${evidence}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    },
    { signal: input.signal },
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("The anatomy answer provider returned no content.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("The anatomy answer provider returned invalid JSON.");
  }
  const parsed = anatomyModelAnswerSchema.safeParse(
    normalizeAnatomyModelAnswer(json, mode, sceneId),
  );
  if (!parsed.success) {
    throw new Error("The anatomy answer did not match the required schema.");
  }

  const allowedStructures = new Set(
    input.entries.flatMap((entry) => entry.structureIds),
  );
  const focusStructures = parsed.data.focusStructures.filter((structure) =>
    allowedStructures.has(structure),
  );
  const resolvedFocus =
    focusStructures.length > 0
      ? focusStructures
      : input.entries[0]?.structureIds.slice(0, 4) ?? [];

  return {
    ...parsed.data,
    animationMode: coerceMode(
      parsed.data.animationMode,
      mode,
      sceneId,
    ),
    focusStructures: resolvedFocus,
    reveal: revealForFocusedStructures(parsed.data.reveal, resolvedFocus),
    citations,
  };
}

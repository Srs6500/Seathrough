/**
 * Free image → 3D: the vision model writes a build brief (proportions, parts,
 * colors, materials) from the photo, then the text model writes Three.js code
 * that runs in the sandboxed scene iframe (see scene-explain/iframeRuntime).
 */

import OpenAI from "openai";
import { getModel3dCodeConfig, getVisionLlmConfig } from "@/lib/env";
import { toDataUrl } from "@/lib/image-explain/extract/types";
import { inspectSceneCode } from "@/lib/scene-explain/inspectCode";

export type ThreeModelProgram = {
  title: string;
  /** Same shape as /api/voice-tutor/identify-image, so 3D mode needs one vision call. */
  subject: string;
  description: string;
  focusOptions: string[];
  /** Short description of what was modeled (for the repair prompt). */
  brief: string;
  code: string;
};

const BRIEF_SYSTEM = `You are a 3D modeler studying a reference photo. Describe the main object so another modeler can rebuild it from simple geometry without seeing the photo.
Return ONLY JSON:
{
  "title": "object name, 1-4 words",
  "description": "1 sentence: what the photo shows",
  "focusOptions": ["3 things a student could learn about it, 2-5 words each"],
  "dimensions": { "length": number, "width": number, "height": number },
  "silhouette": "how the overall outline looks from the side and from the front (curves, taper, roofline, bulges)",
  "parts": [
    {
      "name": "part name",
      "shape": "box | rounded box | cylinder | sphere | cone | torus | capsule | extruded side profile | lathe (spun profile) | thin panel",
      "color": "#rrggbb",
      "material": "glossy paint | metal | chrome | glass | rubber | plastic | fabric | wood | matte | light (emissive)",
      "position": "where it sits relative to the whole (front/back, left/right, top/bottom, how far)",
      "size": "size relative to the whole object",
      "count": 1
    }
  ]
}
Rules:
- dimensions are in scene units; the longest side MUST be 7.
- 6-12 parts, biggest first. Include the parts a student would ask about. Keep every string short (under 15 words) — the whole JSON must stay under 600 words.
- Colors must match the photo (sample the real paint, glass tint, trim).
- Mirror pairs (wheels, mirrors, lights, legs) use count, not separate entries.
- Ignore the background (street, people, table) — only the object.`;

const CODE_SYSTEM = `You write a Three.js r185 body that builds ONE static object model for a sandboxed iframe.

HOST PROVIDES (do not create these): THREE, scene, camera, lights, a grid on y=0, drag-to-orbit, and the animation loop. The camera looks at the origin from ~16 units away.

YOU WRITE a plain JavaScript body that:
- Puts everything in one THREE.Group named "model" added to the scene. The host recenters, scales, and spins it afterwards — just build it upright with +Y as up and the longest side ~7 units.
- Names every part mesh/group (mesh.name = "front left wheel", etc.).
- Parts must TOUCH and connect like the real object — nothing floating in space.

Orientation (Three.js defaults — rotate on purpose):
- CylinderGeometry and ConeGeometry stand along +Y. A wheel or axle lying sideways needs rotation.z = Math.PI / 2.
- TorusGeometry and RingGeometry lie in the XY plane (standing up). A band/ring lying flat needs rotation.x = Math.PI / 2.
- ExtrudeGeometry extrudes a Shape drawn in XY along +Z: draw the SIDE profile in XY (x = length, y = height), extrude by the width, then translate z by -width/2 to center it.
- PlaneGeometry faces +Z.

Modeling rules (fidelity matters — this must look like the photo, not a toy):
- Main body: trace the side silhouette as a THREE.Shape (moveTo/lineTo/quadraticCurveTo/bezierCurveTo, 10-30 points) and ExtrudeGeometry it across the width with bevelEnabled: true, bevelSize/bevelThickness ~0.15-0.4 and bevelSegments 4-6 for smooth rounded edges. Round objects (bottles, vases, bowls) use LatheGeometry from a traced profile instead.
- Add the details on top: windows/glass as thin dark-tinted panels or a separate extruded greenhouse shape, wheels as CylinderGeometry tyres + rims with spokes, lights as emissive thin boxes, handles, mirrors, trim, logos as small shapes.
- Materials: MeshStandardMaterial / MeshPhysicalMaterial. Glossy paint: metalness 0.3-0.6, roughness 0.2-0.35 (MeshPhysicalMaterial clearcoat 1 when glossy). Chrome: metalness 1, roughness 0.15. Glass: color dark, transparent, opacity 0.5-0.7, roughness 0.05. Rubber: roughness 0.9. Lights: emissive with emissiveIntensity 1-2.
- Use exactly the colors in the brief.
- No TextureLoader, no images, no fetch, no import/require/eval, no document/window access.
- Only use geometry classes that exist on THREE (BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, TorusGeometry, CapsuleGeometry, ExtrudeGeometry, LatheGeometry, ShapeGeometry, PlaneGeometry, TubeGeometry, RingGeometry). Use new THREE.Vector2 for Lathe points.
- Repeat ornament around a circle or along a line with a for-loop (e.g. 12 spires around a crown band at angle i * 2π / 12), not one-off copies.
- 200-500 lines. Rich detail: a viewer should recognise the object instantly. Complete, runnable, no placeholders.

Return ONLY the JavaScript body inside one \`\`\`js fenced code block — no prose before or after.`;

/**
 * Appended to every model: wrap whatever was built, scale it to ~8 units,
 * center it on the origin (the host camera looks there), drop the grid to its
 * base, and add a slow turntable — so framing never depends on the LLM.
 */
const FIT_AND_SPIN = `
;(function () {
  var fit = new THREE.Group();
  fit.name = "__fit";
  scene.children.slice().forEach(function (child) {
    if (child.isLight || child.isCamera || child.type === "GridHelper") return;
    fit.add(child);
  });
  scene.add(fit);
  var box = new THREE.Box3().setFromObject(fit);
  if (!box.isEmpty()) {
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var s = 8 / Math.max(size.x, size.y, size.z, 0.0001);
    fit.scale.setScalar(s);
    fit.position.set(-center.x * s, -center.y * s, -center.z * s);
    scene.children.forEach(function (child) {
      if (child.type === "GridHelper") child.position.y = -size.y * s / 2 - 0.01;
    });
  }
  var spin = new THREE.Group();
  spin.name = "__spin";
  scene.remove(fit);
  spin.add(fit);
  scene.add(spin);
  var userUpdate = typeof __update === "function" ? __update : function () {};
  __update = function (dt, time) {
    spin.rotation.y += dt * 0.25;
    userUpdate(dt, time);
  };
  __maxReveal = 1;
})();
`;

function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

/** Compile-only check (never runs the code) so obvious syntax errors retry here. */
function syntaxError(code: string): string | null {
  try {
    new Function("THREE", "scene", "camera", code);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Syntax error";
  }
}

async function describeForModeling(
  image: { bytes: Buffer; mimeType: string },
  signal?: AbortSignal,
): Promise<{ title: string; brief: string; description: string; focusOptions: string[] }> {
  const config = getVisionLlmConfig();
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  const completion = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0.2,
      max_tokens: config.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BRIEF_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Write the modeling brief for the main object in this photo." },
            { type: "image_url", image_url: { url: toDataUrl(image.bytes, image.mimeType) } },
          ],
        },
      ],
    },
    { signal },
  );
  const json = parseJsonObject(completion.choices[0]?.message?.content ?? "");
  const title = typeof json.title === "string" && json.title.trim() ? json.title.trim() : "Object";
  const { description, focusOptions, ...build } = json;
  return {
    title: title.slice(0, 60),
    brief: JSON.stringify(build).slice(0, 6000),
    description: typeof description === "string" ? description.trim().slice(0, 400) : "",
    focusOptions: Array.isArray(focusOptions)
      ? focusOptions
          .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          .map((o) => o.trim().slice(0, 48))
          .slice(0, 3)
      : [],
  };
}

async function writeModelCode(
  title: string,
  brief: string,
  previousError: string | null,
  signal?: AbortSignal,
): Promise<string> {
  const { apiKey, model, baseURL } = getModel3dCodeConfig();
  const client = new OpenAI({ apiKey, baseURL });
  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.3,
      max_tokens: 10000,
      // gpt-oss: some reasoning helps orientation/placement; "high" can burn
      // the whole budget thinking and return no code.
      ...(/gpt-oss/i.test(model) ? { reasoning_effort: "medium" as const } : {}),
      // Plain text, not JSON mode: Groq rejects long code strings as invalid JSON.
      messages: [
        { role: "system", content: CODE_SYSTEM },
        {
          role: "user",
          content: [
            `Object: ${title}`,
            `Modeling brief (from the photo):\n${brief}`,
            previousError
              ? `Your previous attempt failed with: ${previousError}. Write a corrected, complete body.`
              : "Write the complete Three.js body now.",
          ].join("\n\n"),
        },
      ],
    },
    { signal },
  );
  const raw = completion.choices[0]?.message?.content ?? "";
  const fenced = raw.match(/```(?:js|javascript)?[^\n]*\n([\s\S]*?)```/i);
  const code = (fenced ? fenced[1]! : raw).trim();
  if (!code) throw new Error("The 3D coder returned no code.");
  return code;
}

export async function buildThreeModelFromImage(
  image: { bytes: Buffer; mimeType: string },
  signal?: AbortSignal,
): Promise<ThreeModelProgram> {
  const { title, brief, description, focusOptions } = await describeForModeling(image, signal);
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let code: string;
    try {
      code = await writeModelCode(title, brief, lastError, signal);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "No code returned";
      continue;
    }
    const inspected = inspectSceneCode(code);
    if (!inspected.ok) {
      lastError = inspected.reason;
      continue;
    }
    const syntax = syntaxError(code);
    if (syntax) {
      lastError = `SyntaxError: ${syntax}`;
      continue;
    }
    return {
      title,
      subject: title,
      description,
      focusOptions,
      brief: brief.slice(0, 500),
      code: `${code}\n${FIT_AND_SPIN}`,
    };
  }
  throw new Error(`Couldn't write the 3D model code (${lastError ?? "unknown error"}).`);
}

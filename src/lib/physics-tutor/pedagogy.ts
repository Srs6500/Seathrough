import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Fixed MathDial-style rules — not a live HF dataset. */
export function loadPhysicsPedagogyRules(): string {
  if (cached) return cached;
  try {
    cached = readFileSync(
      join(process.cwd(), "src/lib/physics-tutor/pedagogy_rules.md"),
      "utf8",
    ).trim();
  } catch {
    cached = [
      "Teach in short beats. Draw the field mechanism.",
      "One idea per beat. At most one targeted check.",
      "Field lines show force on a positive test charge.",
      "Do not reverse attract/repel for like/opposite charges.",
    ].join("\n");
  }
  return cached;
}

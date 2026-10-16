/**
 * Expand physics symbols so Deepgram says them like a tutor, not letter-by-letter.
 * Captions/board stay as written — only the speak pipeline uses this.
 */

const GREEK_LETTERS: Array<[RegExp, string]> = [
  [/ε₀|ε0|\\varepsilon_?0|\\epsilon_?0/g, "epsilon naught"],
  // Deepgram mumbles "mu"/"pi" — spell phonetically for TTS only
  [/μ₀|μ0|\\mu_?0/gi, "mew naught"],
  [/μ|\\mu\b/gi, "mew"],
  [/ΔV|\\Delta\s*V/g, "delta V"],
  [/ΔU|\\Delta\s*U/g, "delta U"],
  [/ρ/g, "rho"],
  [/σ/g, "sigma"],
  [/Φ|\\Phi/g, "fie"],
  [/φ|\\phi/g, "fie"],
  [/θ|\\theta\b/gi, "thay-tuh"],
  [/π|\\pi\b/gi, "pie"],
];

/** Standalone physics letters/words → spoken forms. */
const TOKEN_MAP: Array<[RegExp, string]> = [
  [/\bE-?field\b/gi, "electric field"],
  [/\bB-?field\b/gi, "magnetic field"],
  [/\belectric field E\b/gi, "electric field E"],
  [/\bpotential difference\b/gi, "potential difference"],
  [/\bpoint charge\b/gi, "point charge"],
  [/\btest charge\b/gi, "test charge"],
  [/\bCoulomb(?:'s)?(?: law)?\b/gi, "Coulomb's law"],
  [/\bGauss(?:'s)?(?: law)?\b/gi, "Gauss's law"],
  // Vectors written as bold/arrow words the model might emit
  [/\bvector E\b/gi, "vector E"],
  [/\bvector F\b/gi, "vector F"],
  [/\bvector B\b/gi, "vector B"],
];

/**
 * After mathToSpeech, expand remaining physics tokens carefully.
 * Avoid rewriting ordinary English words.
 */
export function physicsToSpeech(input: string): string {
  let s = input.trim();
  if (!s) return s;

  for (const [re, spoken] of GREEK_LETTERS) {
    s = s.replace(re, ` ${spoken} `);
  }
  for (const [re, spoken] of TOKEN_MAP) {
    s = s.replace(re, spoken);
  }

  // After mathToSpeech may have left the words "pi" / "mu" / subscript digits
  s = s.replace(/\bmu-?naught\b/gi, "mew naught");
  s = s.replace(/\bmew\s*[₀0]\b/gi, "mew naught");
  s = s.replace(/\bmu\s*[₀0]\b/gi, "mew naught");
  s = s.replace(/\bmu\b/gi, "mew");
  s = s.replace(/\bpi\b/gi, "pie");
  s = s.replace(/\bepsilon-?naught\b/gi, "epsilon naught");
  s = s.replace(/\bepsilon\s*[₀0]\b/gi, "epsilon naught");
  s = s.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, "");

  // F = k q1 q2 / r^2 style already partly handled; name common symbols in formulas.
  s = s.replace(/\bk\b(?=\s*(q|times|q sub|times q))/gi, "Coulomb's constant k");

  // q₁, q_1, q1 → charge q-one (after mathToSpeech may already say "q sub 1")
  s = s.replace(/\bq\s*sub\s*([0-9]+|[a-z])\b/gi, "charge q-$1");
  s = s.replace(/\bq([12])\b/g, "charge q-$1");

  // Lone physics letters as words (not inside longer words)
  // "E points" → "E field points" only when clearly the field symbol mid-lesson
  s = s.replace(/\bthe E\b/g, "the electric field E");
  s = s.replace(/\bthe B\b/g, "the magnetic field B");
  s = s.replace(/\bthe V\b/g, "the potential V");
  s = s.replace(/\bthe F\b/g, "the force F");
  s = s.replace(/\bthe q\b/g, "the charge q");
  s = s.replace(/\bE equals\b/g, "E equals");
  s = s.replace(/\bV equals\b/g, "V equals");
  s = s.replace(/\bF equals\b/g, "F equals");

  // 1/r² leftovers if any
  s = s.replace(/\b1 over r squared\b/gi, "one over r squared");
  s = s.replace(/\br\s*squared\b/gi, "r squared");

  // Spell out common unit abbreviations for clarity
  s = s.replace(/\bN\/C\b/g, "newtons per coulomb");
  s = s.replace(/\bV\/m\b/g, "volts per meter");

  return s.replace(/\s+/g, " ").trim();
}

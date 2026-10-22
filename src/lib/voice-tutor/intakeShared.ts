/**
 * Client-safe topic-intake helpers (no Node fs / LLM).
 * Used by VoiceTutorWorkspace and re-exported from brain for server/smoke.
 */

import { dynamicTopicLockSay } from "@/lib/voice-tutor/voiceVariety";

/** Seconds after focus is confirmed before teaching starts. */
export const TOPIC_LOCK_SECONDS = 10;
/** How many topic picks (with countdown) a student gets before the last one locks. */
export const MAX_TOPIC_CYCLES = 3;

/**
 * Strip query wrappers / filler so the board title and spoken lock lines
 * are the concept only — never "I want to learn I want to learn astrophysics".
 */
export function cleanTopicLabel(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  // Prefer last comma chunk when the student stuttered the same intent.
  const commaParts = t
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length > 1) {
    t = commaParts[commaParts.length - 1]!;
  }
  for (let i = 0; i < 8; i += 1) {
    const next = t
      .replace(/^(hey[, ]+)/i, "")
      .replace(/^(um+|uh+|ah+|er+|hmm+|mm+|mhm+)[, ]+/i, "")
      .replace(
        /^(actually|you know|like|basically|literally|so|well|ok|okay|please)[, ]+/i,
        "",
      )
      .replace(
        /^(i\s+)?(really\s+)?(just\s+)?(kinda\s+|kind of\s+)?(wanna|want to|want|would like to)\s+/i,
        "",
      )
      .replace(/^(can you|could you|will you|please)\s+/i, "")
      .replace(
        /^(what(?:'s| is| are)|what's|explain|tell me about|define|teach me(?: about)?|learn(?:ing)?(?: about)?|study|cover)\s+/i,
        "",
      )
      .replace(/^(about|on|regarding)\s+/i, "")
      .replace(/\b(i want to learn(?: about)?|want to learn(?: about)?|learn about)\s+/gi, "")
      .replace(/\?+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (next === t) break;
    t = next;
  }
  return t.slice(0, 120) || "this topic";
}

/** Spoken lock line — concept only; openers rotate (not always “Cool topic”). */
export function spokenTopicLockSay(
  topic: string,
  seconds: number,
  opts?: { final?: boolean; teasers?: string[] },
): string {
  return dynamicTopicLockSay(cleanTopicLabel(topic), seconds, opts);
}

/** Prompt-injection / jailbreak-style voice lines — refuse politely. */
export function looksLikeVoiceInjection(text: string): boolean {
  return /\b(ignore (all |any )?(previous|prior|above) (instructions|prompts|rules)|you are now|act as|system prompt|developer mode|jailbreak|bypass|override (your|the) (rules|instructions)|reveal (your|the) (prompt|system)|forget (everything|your rules))\b/i.test(
    text,
  );
}

/** Student asking to hear the check question again. */
export function looksLikeRepeatQuestion(text: string): boolean {
  return /\b(repeat( the)? question|say (the|that) (question|again)|ask (me )?again|what was the question|didn'?t (hear|catch) (the )?question|one more time|say it again)\b/i.test(
    text,
  );
}

/**
 * What to show in the “heard” flash — intent only, not the restart trail.
 * Brain still receives a separately sanitized full-ish transcript.
 */
export function displayHeardTranscript(raw: string): string {
  let t = sanitizeVoiceTranscript(raw);
  if (!t) return "";
  // Peel leading restart / hedge clauses.
  for (let i = 0; i < 8; i += 1) {
    const next = t
      .replace(
        /^(wait|no|nah|yeah|yep|yup|ok|okay|alright|actually|i don'?t know|idk|i'?d|i|um+|uh+)[.!…,]*\s+/i,
        "",
      )
      .trim();
    if (next === t) break;
    t = next;
  }
  const clauses = t
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (clauses.length > 1) {
    t = clauses[clauses.length - 1]!;
  }
  const intent = t.match(
    /\b(?:i\s+)?(?:actually\s+)?(?:really\s+)?(?:want to|wanna)\s+(.+)/i,
  );
  if (intent?.[1]) {
    t = intent[1]
      .replace(/^(to\s+)?(learn(?:\s+about)?|study|know about)\s+/i, "")
      .trim();
  }
  t = t.replace(/^(learn(?:\s+about)?|study)\s+/i, "").trim();
  return t || sanitizeVoiceTranscript(raw);
}

/**
 * Mid-lesson doubts answered live (partial). Further doubts park for end-of-lesson.
 * Park starts on the (LIVE_BARGE_ANSWERS + 1)th doubt.
 */
export const LIVE_BARGE_ANSWERS = 2;
/** @deprecated Prefer LIVE_BARGE_ANSWERS — count threshold that parks (live + 1). */
export const MAX_LESSON_BARGE_DOUBTS = LIVE_BARGE_ANSWERS + 1;
/** Max times we'll re-speak the same check question. */
export const MAX_CHECK_QUESTION_REPEATS = 3;

/** True when a mid-lesson "partial" answer wrongly promises an end-of-lesson deferral. */
export function looksLikeParkLanguage(text: string): boolean {
  return /\b(at the end|end of (the )?lesson|park(?:ed|ing)? (?:that|it|this)|save(?:d)? (?:that|it) for|come back to (?:that|it|this) (?:at|later|when)|later on the board|when we finish|wrap(?:-|\s)?up|close-?out)\b/i.test(
    text,
  );
}

/** Excited / reactive barge-in — acknowledge vibe, keep teaching. */
export function looksLikeExcitementAck(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /^(damn|dang|wow|whoa|whoah|cool|nice|sick|fire|dope|lit|yess+|yeah+|yep|yup|oh+|ooh+|ahh+|interesting|amazing|awesome|love it|lets? go|go on|continue|keep going|okay|ok|alright|right|true|fair|makes sense)\.?!?$/i.test(
      t,
    )
  ) {
    return true;
  }
  // Short hype with no question / confusion cue.
  if (
    t.split(/\s+/).length <= 4 &&
    /\b(damn|wow|whoa|cool|nice|sick|fire|awesome|amazing|love|insane|crazy)\b/i.test(
      t,
    ) &&
    !/\b(wait|what|why|how|don'?t|confused|explain|mean|unclear|lost|slow)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Mid-lesson “pause, I didn’t get that” — needs a real clarify aside. */
export function looksLikeConfusionAside(text: string): boolean {
  return /\b(wait|hold on|hang on|pause|slow down|one sec|one second|i (?:don'?t|didn'?t) (?:get|understand|follow)|i'?m (?:lost|confused)|not sure (?:i|what)|what does that mean|what do you mean|can you (?:explain|repeat|say that again)|explain that|unclear|confused|lost me|go back)\b/i.test(
    text,
  );
}

export function looksLikeAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|yup|yea|ok|okay|sure|alright|right|got it|makes sense|clear|all good|continue|keep going|go on|mm+hmm+|uh huh)\.?$/i.test(
    text.trim(),
  );
}

export function looksLikeNegative(text: string): boolean {
  return /^(no|nope|nah|not really|not yet|still confused|still lost|don'?t get it|i don'?t)\.?$/i.test(
    text.trim(),
  ) || /\b(still (?:confused|lost|unclear)|not clear|don'?t (?:get|understand) it)\b/i.test(
    text,
  );
}

/** Casual spoken options — never "1) … 2) …". */
export function casualFocusSay(parent: string, options: string[]): string {
  const opts = options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
  if (opts.length >= 4) {
    return `For ${parent}, what do you want to dig into — ${opts[0]}, ${opts[1]}, ${opts[2]}, or ${opts[3]}?`;
  }
  if (opts.length === 3) {
    return `For ${parent}, what do you want to dig into — ${opts[0]}, ${opts[1]}, or ${opts[2]}?`;
  }
  if (opts.length === 2) {
    return `For ${parent}, are you more into ${opts[0]}, or ${opts[1]}?`;
  }
  if (opts.length === 1) {
    return `For ${parent}, want to start with ${opts[0]}, or something else?`;
  }
  return `What part of ${parent} should we start with?`;
}

/**
 * Keep the parent subject in the lesson topic.
 * "applications" + "physics" → "applications of physics"
 * (avoids planning a bare "applications" → software apps mismatch).
 */
export function qualifyFocusWithParent(focus: string, parent: string): string {
  const f = cleanTopicLabel(focus);
  const p = cleanTopicLabel(parent);
  if (!p || /^this topic$/i.test(p)) return f;
  if (!f) return p;
  const fl = f.toLowerCase();
  const pl = p.toLowerCase();
  if (fl.includes(pl) || pl.includes(fl)) return f;
  // Already phrased as "X of/in/for Y"
  if (/\b(of|in|for|on|about)\b/i.test(f)) return f;
  return `${f} of ${p}`;
}

/** Drop intensifiers so "random ass things" ≈ "random things". */
export function stripTopicIntensifiers(raw: string): string {
  return raw
    .replace(
      /\b(ass|damn|freaking|frickin'?|bloody|stupid|dumb|crazy|weird)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Vague asks that aren't a real subject yet — don't invent Java/Megan/etc. */
export function looksLikeVagueTopic(text: string): boolean {
  const t = stripTopicIntensifiers(cleanTopicLabel(text)).toLowerCase();
  if (!t) return true;
  // Any "random …" ask is vague until they name a real subject.
  if (/^random\b/.test(t)) return true;
  return /^(anything|something|stuff|whatever|idk|surprise me|anything cool|some stuff|things|some things|whatever you (want|think))$/i.test(
    t,
  );
}

/** Single proper-name topics the model sometimes invents (e.g. "Megan"). */
export function looksLikeInventedPersonTopic(text: string): boolean {
  const t = cleanTopicLabel(text).trim();
  if (!t) return false;
  // One capitalized-looking token, letters only — not a real school subject.
  if (/^[A-Z][a-z]{2,12}$/.test(t)) return true;
  if (/^[a-z]{3,12}$/i.test(t) && /^(megan|sarah|john|alex|mike|emma|olivia|liam)$/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * True topic *switch* intent — NOT mid-lesson doubts.
 * (Do not match bare "explain" / "teach me" — those are doubts.)
 */
export function looksLikeTopicNudge(text: string): boolean {
  if (
    /\b(change topics?|switch topics?|different topic|another topic|something else entirely|never\s*mind(?:\s+that)?|forget(?:\s+that)?|instead (?:let'?s|can we)|rather (?:learn|study|do)|how about we (?:switch|change|do something else)|what about (?:learning|studying) (?!this|that|it)\w+|can we (?:switch|change topics?)|let'?s (?:switch|change topics?|do something else)|i (?:wanna|want to) (?:learn|study) (?:about )?(?!this|that|it)\w+)/i.test(
      text,
    )
  ) {
    return true;
  }
  // "let's actually learn about physics" / "can we study airplanes"
  return /\b(?:let'?s|can we|could we)\s+(?:actually\s+)?(?:learn|study|switch to|talk about)\b/i.test(
    text,
  );
}

/** Pull the subject out of a nudge like "let's actually learn about physics". */
export function extractTopicFromNudge(raw: string): string {
  let t = raw.trim();
  for (let i = 0; i < 4; i++) {
    const next = t
      .replace(/^(hey[, ]+)?/i, "")
      .replace(/^(wait|actually|ok|okay|so|um+|uh+)[, ]+/i, "")
      .replace(
        /^(can we|could we|let'?s|i (?:wanna|want to)|how about|what about)\s+/i,
        "",
      )
      .replace(
        /^(learn|study|talk|cover|do|hear|switch)\s+(about\s+|to\s+)?/i,
        "",
      )
      .replace(/^(teach me|explain)\s+(about\s+)?/i, "")
      .replace(/^(something|a bit)\s+(about\s+|on\s+)?/i, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  return cleanTopicLabel(t);
}

/** Reject filler / noise so we don't invent a lesson from a mumble. */
export function looksLikeMumble(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length < 3) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (
    /^(um+|uh+|ah+|er+|hmm+|mm+|mhm+|like|yeah|yep|yup|yes|ok|okay|so+|well|huh|what)\.?$/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    words.length <= 2 &&
    /^(um+|uh+|ah+|er+|hmm+|mm+|like|yeah|yes|ok|okay|so+|well)\b/i.test(t)
  ) {
    return true;
  }
  const letters = (t.match(/[a-z]/gi) || []).length;
  if (t.length >= 4 && letters / t.length < 0.45) return true;
  if (
    words.length <= 4 &&
    words.every((w) =>
      /^(um+|uh+|ah+|er+|hmm+|mm+|like|you know|basically|literally|just|so|and|the|a|i|me)$/i.test(
        w.replace(/[^a-z]/gi, ""),
      ),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Strip leading/trailing voice fillers before the tutor brain sees the transcript.
 * Keeps meaning; does not invent words.
 */
export function sanitizeVoiceTranscript(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  for (let i = 0; i < 4; i += 1) {
    const next = t
      .replace(/^(um+|uh+|ah+|er+|hmm+|mm+|mhm+)[,.\s]+/i, "")
      .replace(/^(like|you know|basically|literally)[,.\s]+/i, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  t = t
    .replace(/[,.\s]+(um+|uh+|ah+|er+|hmm+|mm+)\.?$/i, "")
    .replace(/\.{2,}$/g, "")
    .trim();
  return t;
}

/**
 * Heuristic: STT cut the student off mid-thought (thinking pause).
 * Keep listening instead of sending a half phrase to the LLM.
 * Short content answers ("force", "chloroplasts") count as complete.
 */
export function looksIncompleteUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/[?!]$/.test(t)) return false;
  if (/[.!]$/.test(t) && t.split(/\s+/).length >= 3) return false;
  if (/\b(um+|uh+|ah+|er+|hmm+)\.?$/i.test(t)) return true;
  // Trailing glue words usually mean they paused mid-sentence.
  if (
    /\b(and|or|but|so|because|if|when|while|that|which|who|the|a|an|to|for|with|of|about|into|onto|from|my|your|is|are|was|were|want|wanna|like|learn|study|explain|tell)\.?$/i.test(
      t,
    )
  ) {
    return true;
  }
  const words = t.split(/\s+/).filter(Boolean);
  if (/^(yes|no|ok|okay|stop|wait|next|hint|help)\.?$/i.test(t)) return false;
  const hasContent = words.some((w) => {
    const c = w.replace(/[^a-z]/gi, "");
    return (
      c.length >= 3 &&
      !/^(um+|uh+|ah+|er+|hmm+|the|and|but|for|with|that|this|like|yeah|yes|okay|you|know)$/i.test(
        c,
      )
    );
  });
  // Pure fragments with no content word → wait for more.
  if (!hasContent) return true;
  return false;
}

/** Ordinal / listed option only — not a free-form new subject. */
export function matchListedFocus(
  userText: string,
  focusOptions: string[],
): string | null {
  const raw = userText.trim();
  if (!raw) return null;

  const t = raw
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const options = focusOptions.map((o) => o.trim()).filter(Boolean);

  const ordinal: Record<string, number> = {
    "1": 0,
    one: 0,
    first: 0,
    a: 0,
    "2": 1,
    two: 1,
    second: 1,
    b: 1,
    "3": 2,
    three: 2,
    third: 2,
    c: 2,
    "4": 3,
    four: 3,
    fourth: 3,
    d: 3,
  };
  const ordHit = t.match(
    /^(?:option|number|choice)?\s*(1|2|3|4|one|two|three|four|first|second|third|fourth|a|b|c|d)\b/,
  );
  if (ordHit) {
    const idx = ordinal[ordHit[1]!] ?? -1;
    if (idx >= 0 && options[idx]) return options[idx]!;
  }

  if (looksLikeMumble(raw)) return null;

  for (const opt of options) {
    const o = opt.toLowerCase();
    if (t === o || t.includes(o) || o.includes(t)) return opt;
  }
  return null;
}

/** True when the student is abandoning the parent for a different subject. */
export function isTopicSwitchAway(
  userText: string,
  parentTopic: string,
  focusOptions: string[],
): boolean {
  if (matchListedFocus(userText, focusOptions)) return false;
  if (looksLikeMumble(userText)) return false;

  const parent = cleanTopicLabel(parentTopic).toLowerCase();
  const cleaned = extractTopicFromNudge(userText).toLowerCase();
  if (!cleaned) return false;
  if (cleaned === parent || parent.includes(cleaned) || cleaned.includes(parent)) {
    return false;
  }

  const parentTokens = new Set(parent.split(/\s+/).filter((w) => w.length > 2));
  const tokens = cleaned.split(/\s+/).filter((w) => w.length > 2);
  const overlapsParent = tokens.some((t) => parentTokens.has(t));
  const overlapsOption = focusOptions.some((opt) => {
    const o = opt.toLowerCase();
    return tokens.some((t) => o.includes(t) || t.includes(o.split(/\s+/)[0] ?? ""));
  });
  if (overlapsOption) return false;

  if (looksLikeTopicNudge(userText)) return true;
  if (!overlapsParent && tokens.length > 0 && tokens.length <= 6) return true;
  return false;
}

/** Map a clarify answer (1 / baking / first one) onto a concrete focus. */
export function resolveFocusChoice(
  userText: string,
  parentTopic: string,
  focusOptions: string[],
): string | null {
  const listed = matchListedFocus(userText, focusOptions);
  if (listed) return listed;
  if (isTopicSwitchAway(userText, parentTopic, focusOptions)) return null;
  if (looksLikeMumble(userText)) return null;
  const cleaned = cleanTopicLabel(userText);
  return cleaned || null;
}

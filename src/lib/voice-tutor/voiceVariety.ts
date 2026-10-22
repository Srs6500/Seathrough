/**
 * Rotating tutor lines — avoids hardcoding the same lock / barge / ending every time.
 * No extra libraries: ring buffers + random pick + negative history in prompts.
 */

function pickIndex(n: number): number {
  if (n <= 1) return 0;
  return Math.floor(Math.random() * n);
}

export function pickVariant(pool: readonly string[]): string {
  if (!pool.length) return "";
  return pool[pickIndex(pool.length)]!;
}

/** Fill `{topic}` / `{a}` / `{b}` / `{c}` placeholders. */
export function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

const LOCK_WITH_TEASERS = [
  "Nice pick — {topic}. We'll dig into {tail}. Starting in {seconds} seconds unless you want to change.",
  "Love that — {topic}. Think {tail}. Starting in {seconds} seconds unless you want to switch.",
  "Solid choice — {topic}. We'll touch {tail}. Starting in {seconds} seconds unless you change your mind.",
  "Alright, {topic} it is. Expect {tail}. Starting in {seconds} seconds unless you want something else.",
  "Great call — {topic}. We'll explore {tail}. Starting in {seconds} seconds unless you want to change.",
] as const;

const LOCK_PLAIN = [
  "Nice pick — {topic}. Starting in {seconds} seconds unless you want to change.",
  "Love that focus — {topic}. Starting in {seconds} seconds unless you switch.",
  "Solid — locking in {topic}. Starting in {seconds} seconds unless you want something else.",
  "Alright, {topic} it is. Starting in {seconds} seconds unless you change your mind.",
] as const;

const LOCK_FINAL = [
  "Alright — {topic}. Locking that in now — this'll be a good one.",
  "Perfect — {topic}. We're starting now.",
  "{topic} it is. No more switches — let's go.",
  "Locked on {topic}. Here we go.",
] as const;

const FINISH_LESSON_HOLD = [
  "Love the curiosity — let's finish this lesson first, then we can jump to that next.",
  "Good instinct — hold that thought until we wrap this lesson, then we'll switch.",
  "Noted — let's complete what we started here first, then we can open that topic.",
  "Fair ask — stay with me through this lesson, and we'll pick that up right after.",
] as const;

const BARGE_PARKED = [
  "Totally fair question — don't worry, I'll cover that properly at the end of the lesson on the board. For now let's keep our thread going.",
  "Good catch — I'll park that and unpack it on the board when we finish. Stick with me for a bit.",
  "I hear you — we'll come back to that at the end, written up clearly. Let's keep momentum for now.",
  "Solid doubt — I'll save it for the close-out on the board. Let's finish this stretch first.",
] as const;

const BARGE_LOCKED = [
  "I've got your question noted — let's finish this stretch, and I'll come back to it at the end on the board.",
  "Already saved — we'll hit your parked questions at the end. Almost there.",
  "Got it on the list — end of lesson I'll put it on the board. Stay with the flow for now.",
] as const;

const EXCITEMENT_ACK = [
  "Yeah — let's keep going.",
  "Nice — staying with it.",
  "Good energy — next beat.",
  "Love it — onward.",
] as const;

const ENDINGS = [
  "Alright — that sums up {topic}. You asked sharp questions, and that curiosity is the whole point. Great session — grab the PDF anytime if you want a keepable copy.",
  "And that's a wrap on {topic}. You stayed with it — that's how real understanding sticks. Awesome work; download the PDF if you want notes later.",
  "There we go — {topic} in the bag. You showed up and pushed when it got unclear. Proud of that — PDF's there if you want a revisit.",
  "Session complete on {topic}. Asking doubts mid-lesson is a strength, not a detour. Well done — export the PDF whenever you like.",
] as const;

const DEFERRED_INTRO = [
  "Coming back to what you asked earlier —",
  "Quick revisit of your parked question —",
  "As promised, let's settle that earlier doubt —",
  "Before we close, that thing you asked —",
] as const;

const OVERVIEW_LABELS = [
  "{topic} big picture",
  "{topic} from scratch",
  "touring {topic}",
  "intro to {topic}",
  "{topic} foundations walkthrough",
  "first look at {topic}",
] as const;

export function dynamicTopicLockSay(
  topic: string,
  seconds: number,
  opts?: { final?: boolean; teasers?: string[] },
): string {
  const t = topic.trim() || "this topic";
  if (opts?.final) {
    return fillTemplate(pickVariant(LOCK_FINAL), { topic: t });
  }
  const teasers = (opts?.teasers ?? [])
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (teasers.length >= 2) {
    const tail =
      teasers.length >= 3
        ? `${teasers[0]}, ${teasers[1]}, and ${teasers[2]}`
        : `${teasers[0]} and ${teasers[1]}`;
    return fillTemplate(pickVariant(LOCK_WITH_TEASERS), {
      topic: t,
      tail,
      seconds: String(seconds),
    });
  }
  return fillTemplate(pickVariant(LOCK_PLAIN), {
    topic: t,
    seconds: String(seconds),
  });
}

export function dynamicFinishLessonHold(): string {
  return pickVariant(FINISH_LESSON_HOLD);
}

export function dynamicBargeParked(): string {
  return pickVariant(BARGE_PARKED);
}

export function dynamicBargeLocked(): string {
  return pickVariant(BARGE_LOCKED);
}

export function dynamicExcitementAck(): string {
  return pickVariant(EXCITEMENT_ACK);
}

export function dynamicLessonEnding(topic: string): string {
  return fillTemplate(pickVariant(ENDINGS), {
    topic: topic.trim() || "this topic",
  });
}

export function dynamicDeferredIntro(): string {
  return pickVariant(DEFERRED_INTRO);
}

/** Rotating “overview” chip — not always “general Java”. */
export function dynamicOverviewOption(topic: string): string {
  return fillTemplate(pickVariant(OVERVIEW_LABELS), {
    topic: topic.trim() || "this topic",
  });
}

/** Word-overlap similarity for filtering near-duplicate focus chips. */
export function focusTooSimilar(a: string, b: string): boolean {
  const wa = new Set(
    a
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
  const wb = new Set(
    b
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / Math.min(wa.size, wb.size) >= 0.7;
}

const FOCUS_STORAGE_KEY = "vt.offeredFocus.v1";

export function loadOfferedFocusMap(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function persistOfferedFocus(parentKey: string, options: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const map = loadOfferedFocusMap();
    const prev = map[parentKey] ?? [];
    const merged = [...prev];
    for (const o of options) {
      const t = o.trim();
      if (!t) continue;
      if (merged.some((x) => focusTooSimilar(x, t) || x.toLowerCase() === t.toLowerCase())) {
        continue;
      }
      merged.push(t);
    }
    map[parentKey] = merged.slice(-40);
    window.localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

export function avoidedFocusForParent(parent: string): string[] {
  const key = parent.trim().toLowerCase();
  const map = loadOfferedFocusMap();
  return map[key] ?? [];
}

# Voice Tutor — circling, white-space diagrams (tldraw + physics SVGs)

**Status:** Next board/visual track (voice duplex / STT / TTS / barge / wake pass is done — see [`voice-tutor-test-cases.md`](voice-tutor-test-cases.md)).  
**Related:** [`seethrough-product-vision.md`](seethrough-product-vision.md) §6 (selective highlighting, distillation) and §7.1 (tutor visuals). §7.2–7.3 tracing is **out of this track**.  
**Product intent:** Voice Tutor becomes the unified tutor. Smart Tutor’s **tldraw** sketch DNA and Physics Tutor’s **VFPt SVG** diagrams move here into white-space gutters so those standalone modes become visually toothless over time. Voice already owns ask → explain → check; what’s missing is accurate circling + those two diagram systems.

---

## 1. Philosophy (why this exists)

Deepgram TTS is only the **mouth**. The board must teach like a real tutor: against a wall of text, the learner should **not** read a book — they should leave able to **apply a concept or write an answer**.

Marking must be:

1. **Selective** — circle / highlight only the application-critical span (3–8 words when possible), never paint the whole paragraph.
2. **Directed** — every mark has a side-note (“how to remember / how to apply”) and ideally a recall prompt.
3. **Accurate** — strokes land on the real phrase (DOM-measured), not approximate guesses.
4. **Spatially calm** — diagrams use leftover white space / gutters; they must **never** sit on or crush the text column.

“Tutor” understates this: the product is an **application-first coach** that extracts what matters and makes it stick.

---

## 2. Product move (Smart + Physics → Voice)

| Mode today | What it owns | What Voice absorbs |
|---|---|---|
| **Smart Tutor** (`ExperimentBoard` + tldraw) | Hand-drawn geos / arrows / text / sheets via `applyScene.ts` + `ExperimentShape` | Same sketch language, rendered in Voice **gutters** (not a full-bleed tldraw takeover of the lesson column) |
| **Physics Tutor** (`ExperimentBoard kind="physics"`) | Same board + VFPt SVG/PNG attach via `attachPhysicsDiagramToLesson` + `pickDiagramsForPrompt` | Same VFPt retrieval, placed as gutter images when the topic is physics / fields |
| **Voice Tutor** | Orb, duplex voice, Socratic checks, glass passage, thin `highlight` / `rememberTip` | Keeps pedagogy; **gains** accurate circling + Smart sketches + Physics SVGs |

**Naming note:** Smart Tutor uses **tldraw**, not Excalidraw. Excalidraw in this repo is System Design / automatic-drawing — **not** this track. Sketch feel should match Smart’s hand-drawn board language.

**Hard layout rule:** tldraw sketches and physics SVGs live only in free gutter space. If there is no free rect, **skip or defer** the diagram — never overlap passage text, side-note chips, or circled spans.

---

## 3. Layers to solve

| Layer | Job | Question it answers |
|---|---|---|
| **A. Extraction** | Decide *what* to mark | Which exact phrase is the apply/recall unit? |
| **B. Strokes / UI** | Draw *how* | Circle, underline, arrow to “how to remember” |
| **C. Pedagogy data** | Shape *why* / *what next* | Side-notes, recall Qs, exam-style prompts |
| **D. White-space layout** | Place *where* | Gutters only; collision-aware packing |
| **E. Diagram sources** | Place *what figure* | Smart-style tldraw sketches **or** Physics VFPt SVGs (topic-gated) |

**Out of this track:** learner tracing, guided reconstruction, sonification (§7.2–7.4 in product vision). Scaffold that already exists for tracing (`InteractiveDiagram` trace mode) stays dormant — do not wire it into the lesson loop yet.

---

## 4. Existing stack hooks (do not reinvent)

### Voice Tutor (already present)

| Hook | Path | Role |
|---|---|---|
| Thin highlight | `BoardContent.highlight` / `rememberTip` / `examCue` / `pointer` in `sessionTypes.ts` | Single fuzzy marker today — upgrade target |
| Passage UI | `LivingPassage.tsx`, `LessonStage.tsx` | Lyric-stack text; must grow exact phrase wraps |
| Rough overlay scaffold | `RoughMarkOverlay.tsx` | roughjs circles / underlines / tip arrows |
| Gutter packer | `gutterLayout.ts` (`packGutterPlacements`) | Vertical collision resolver |
| Gutter shell | `DiagramGutter.tsx` | Right-side absolute lane (currently only `svg_graph` VisualScene) |
| Simple scenes | `DrawScene` (`svg_graph` \| `concept_boxes` \| `none`), `SceneCanvas`, `BoardWow` | Keep as fallback / lightweight graphs |
| Highlight ranking | `pickHighlight.ts` | Prefer substance over meta “definition” |
| Annotation gold | `annotationGold.ts` + few-shot helper | SQuAD-style exact-span examples for extractor prompts |
| Smoke stubs | `scripts/smoke-board-annotations.ts`, `smoke-gutter-layout.ts`, `smoke-trace-score.ts` | Extend; tracing smokes can stay unused |

### Smart Tutor (source of sketch DNA)

| Hook | Path | Role |
|---|---|---|
| Board shell | `ExperimentBoard.tsx` | Full-viewport tldraw + teaching script |
| Draw pipeline | `applyScene.ts` (`drawExperimentLessonNow`, shape → tldraw) | Geo / text / note / callout / arrow / image / route |
| Scene model | `lib/experiment/scene.ts` (`ExperimentShape`, beats, sheets) | Canonical sketch IR |

Voice does **not** need to mount a full Smart-style infinite tldraw lesson. Prefer: generate or reuse compact `ExperimentShape[]` (or a thin Voice-facing sketch IR) and render a **bounded sketch card** in the gutter (embedded tldraw editor, static snapshot, or Konva/SVG projection of the same shapes — pick one in Phase 2; prefer reuse of `applyScene` shape mapping for fidelity).

### Physics Tutor (source of field diagrams)

| Hook | Path | Role |
|---|---|---|
| Diagram index + score | `lib/physics-tutor/diagrams.ts` (`listVfptDiagrams`, `pickDiagramsForPrompt`, `scoreDiagram`) | Closest-match VFPt files |
| Attach to lesson | `lib/physics-tutor/attach.ts` (`attachPhysicsDiagramToLesson`) | Pins top SVG as `type: "image"` on beat 1 |
| Assets | `public/physics/vfpt/`, `Physics-tutor-data/vfpt-svgs/` | SVG/PNG corpus |
| Public URL | `/physics/vfpt/{filename}` | Same URLs Voice should use in gutters |

When Voice topic/beat looks like electrostatics / fields / circuits / magnetism (reuse synonym tokens from `diagrams.ts`), call the same picker and place the image in the gutter — not only when the user opened `/physics-tutor`.

---

## 5. A. Extraction — what to circle

Do **not** rely on TTS text alone. Route lesson/passage chunks through a structured model pass **before** speak + draw.

### Schema (primary)

Force JSON (Zod / structured outputs), e.g.:

```json
{
  "raw_paragraph": "…passage…",
  "annotations": [
    {
      "id": "marker_1",
      "target_phrase": "exact substring present in raw_paragraph",
      "style": "circle",
      "side_note": "How to apply / remember in one short line",
      "recall_question": "Question that tests application, not trivia",
      "exam_cue": "Optional formal phrasing for written answers"
    }
  ],
  "diagram": {
    "trigger_phrase": "optional phrase that warrants a figure",
    "kind": "tldraw_sketch | vfpt_svg | svg_graph | none",
    "spec": {}
  }
}
```

Rules for the extractor:

- `target_phrase` **must** be an exact contiguous substring of the passage (enables DOM wrap).
- Prefer **apply / transform / condition** spans over decorative adjectives.
- Cap annotations per beat (e.g. 1–3) so the board stays scannable.
- Reject empty / whole-sentence circles when a shorter span exists.
- Wire few-shots from `annotationFewShotBlock()` (`annotationGold.ts`).

### Lightweight assist (optional, non-LLM)

- Keyphrase / NER candidates → LLM ranks/filters to pedagogy.
- Do not ship raw NER circles without the apply filter.

### Tie-in to current Voice Tutor

Today `beat.board.highlight` + `rememberTip` + `pointer` + `examCue` are a thin version of this. Upgrade:

- Many precise markers + validated phrases + `recall_question`
- Keep single-highlight as fallback when multi-annotation extraction fails
- `pickHighlight` remains the offline / repair path for one span

---

## 6. B. Strokes / UI — accurate circles, arrows, side-notes

### Libraries (fit our stack)

| Tool | Use | Notes |
|---|---|---|
| **`roughjs`** (in `package.json`; `RoughMarkOverlay.tsx`) | Hand-drawn ellipses / underlines | Matches sketch-tutor feel |
| **Rough paths / LeaderLine (candidate)** | Phrase → side-note arrow | Prefer Rough first to avoid a new dep |
| **`getBoundingClientRect` / Range API** | Exact pixel boxes for wrapped phrases | Required for accurate circling |
| **tldraw** (Smart path) | Sketch cards in gutters | Not for circling strokes |
| **VFPt SVG/PNG** | Physics field figures in gutters | Retrieved, not free-drawn |

### Pipeline

1. Render passage HTML (LivingPassage / stanza stack).
2. Wrap each `target_phrase` in `<span class="highlight-target" data-id="marker_N">…</span>` (only exact matches).
3. Overlay a full-board SVG (`pointer-events: none`) sized to the lesson stage (`RoughMarkOverlay`).
4. For each marker: measure rect(s) → Rough ellipse / underline with padding.
5. Draw arrow / curve to a side-note chip (`side_note` / `rememberTip`).
6. Sync with voice: when TTS reaches that beat / highlight, animate that marker (opacity / draw-on).

### Accuracy checklist

- Re-measure on resize / stanza write / scroll.
- If phrase not found in DOM → **skip stroke** (never circle the wrong span).
- Prefer `Range` + multi-line rects when a phrase wraps.
- Circles and tip chips are **obstacles** for gutter packing (layer D).

---

## 7. C. Pedagogy datasets & patterns (side-notes + recall)

Goal: bite-sized apply/recall units, not summaries.

| Source | Why it helps |
|---|---|
| **SQuAD 2.0** | Answer = span in the passage → short applied answer |
| **Flashcard / text-to-Anki datasets** | Chapter → atomized Q&A |
| **Leitner / spaced-repetition public sets** | Item sizing patterns (structure, not content) |
| **In-repo gold** | `annotationGold.ts` — start here for eval |

**Practical approach (no fine-tune day one):**

1. Schema + few-shots from `annotationFewShotBlock()` in the extractor prompt.
2. Grow the gold set: passage → circles → side-note → recall Q → optional exam cue.
3. Later: fine-tune or RAG over gold if quality plateaus.

Side-note patterns:

- **Remember:** one mnemonic / transform rule.
- **Apply:** “When you see X in a problem, do Y.”
- **Ask:** one recall question Voice can speak on the check beat.

---

## 8. D. Diagrams only in white space (gap placement)

On a large screen, diagrams occupy **leftover real estate** — gutters / gaps — never the text wall.

### Layout principle

- **Text lane:** readable column (not full-bleed prose on ultrawide).
- **Diagram lane / gutter:** packed zone beside text (`DiagramGutter` pattern; ~right 25–28% on `xl+`, hidden or stacked carefully on small screens).
- When a diagram triggers, place it at the **Y of the triggering phrase / active stanza**, then resolve collisions downward.

### Detection / packing

1. **Obstacle boxes** — text blocks, highlight tip chips, existing `.placed-diagram` → measured boxes.
2. **Vertical resolver (v1)** — already sketched in `packGutterPlacements` (`gutterLayout.ts`):
   - `triggerTop` = offset of trigger phrase / stanza
   - Candidate rect in diagram lane at that Y
   - While overlapping occupied band → `top += gap`
3. Optional later: MaxRects / skyline if vertical-only packing is not enough.

### Re-pack triggers

- Resize, new stanza, new annotation tips, new diagram, scroll container size change.

### Hard failures

- No free space → do not draw; keep teaching with text + circles only.
- Wrong topic diagram (e.g. random circuit on WWII) → reject; picker score threshold.

---

## 9. E. Diagram sources (what goes in the gutter)

| Source | When | How |
|---|---|---|
| **Smart-style tldraw sketch** | General concepts, processes, comparisons, structures | Compact `ExperimentShape[]` (or equivalent) → bounded sketch card in gutter; reuse Smart draw DNA from `applyScene` / scene IR |
| **Physics VFPt SVG/PNG** | Electrostatics, fields, circuits, magnetism, related prompts | `pickDiagramsForPrompt` → `/physics/vfpt/...` image card in gutter |
| **Existing `DrawScene` / `svg_graph`** | Function graphs / lightweight VisualScene | Keep as fallback inside gutter via current `SceneCanvas` path |
| **Mermaid** | Only if user/lesson clearly needs a flow | Optional later; not phase-1 |

### Topic gating (physics)

Reuse synonym / topic scoring from `lib/physics-tutor/diagrams.ts`. Do not force field diagrams on non-physics topics (same rule as Physics Tutor context: do not invent field figures for unrelated asks).

### Sketch gating (tldraw)

- Prefer a sketch when a spatial / structural relation helps more than another paragraph.
- Cap sketches per lesson (e.g. 1–3) so the gutter stays calm.
- Validate labels against the active topic (no Java/Megan-style bleed — same hygiene as Voice subtopics).

### Sync with voice

- Reveal / place diagram when the beat that triggered it is spoken (or when `trigger_phrase` is circled).
- Do not animate diagrams over the text column.

---

## 10. Phased build

### Phase 0 — Preconditions (done)

- Voice pipe: streaming STT/TTS, Silero barge-in, duplex, wake, park/check pedagogy.
- Manual cases in `voice-tutor-test-cases.md` cleared.

### Phase 1 — Smart text marking (circling accuracy) ✅ done

1. Formalize `BoardAnnotation` on teach beats: exact `targetPhrase` + `style` + `sideNote` + `recallQuestion` + optional `examCue` (`sessionTypes.ts`).
2. Wire extractor into lesson plan / beat board generation (`boardAnnotations.ts`, `withNormalizedAnnotations` in `sanitizeBeatBoard`, gold few-shots in draft prompt).
3. DOM wrap in `LivingPassage` + `RoughMarkOverlay` (exact spans only).
4. Arrows to side-note chips via Rough paths; tips stagger when multiple marks.
5. Voice-sync: after stanza write completes → reveal marks (active beat only; frozen stanzas keep marks).
6. Hard rule: no phrase in passage → annotation dropped (never wrong circle).
7. Smokes: `npm run smoke:board-annotations`.

### Phase 2 — White-space gutters + diagram hosts ✅ done

1. Split text lane vs diagram gutter in LessonStage / board shell; wire `DiagramGutter` + `packGutterPlacements`.
2. Re-pack on resize / new stanza / new tips (`data-vt-tip` obstacles).
3. Host A: **Physics VFPt** image cards via strict `pickVfptForVoiceTutor` (electric topic gate + score floor; no weak fallback).
4. Host B: **Real Smart Tutor tldraw** (`VoiceTldrawBoard` + `applyExperimentScene`) in a proper board pane — not a tiny SVG card. Spec still `tldraw_sketch` boxes → ExperimentShape.
5. Keep `svg_graph` / InteractiveDiagram (view) as gutter fallback for graphs.
6. Smokes: `npm run smoke:gutter-layout`, `npm run smoke:vfpt-voice-gate`.
7. Attach path: `attachVoiceDiagrams` at end of `normalizePlanTeachFirst` in `brain.ts`.

### Phase 3 — Brain routing (make Smart/Physics toothless) ✅ done (server-enforced)

1. Lesson draft JSON includes `diagramKind`: `auto` | `vfpt_svg` | `tldraw_sketch` | `none` (prompt in `brain.ts`).
2. `planFromDraft` stamps `draw.spec.policy`; `attachVoiceDiagrams` fills/sanitizes after normalize.
3. Physics-looking topics get VFPt only when topic gate + score clear; invalid VFPt draws are stripped.
4. General topics get sketch when ≥2 key points (auto / tldraw_sketch); `none` skips attach.
5. Voice remains the only UX students need for ask → explain → check → diagram.

### Phase 4 — Later (explicitly not now)

1. Learner tracing / reconstruction (`InteractiveDiagram` trace mode).
2. Full-bleed tldraw replacing the glass board (undesired — Voice stays passage-first).
3. Excalidraw system-design libs inside Voice (separate product surface).

---

## 11. What we are *not* doing in this track

- Rebuilding Smart/Physics as separate voice apps.
- Mounting a full infinite tldraw canvas over the Voice lesson column.
- Using Excalidraw for Voice gutters (wrong stack; Smart = tldraw).
- Learner tracing / reconstruct-from-blank (parked).
- Circling approximate / wrong spans when the phrase is missing from the DOM.
- Diagrams that overlap text, tips, or each other.
- Forcing VFPt field art onto non-physics lessons.

---

## 12. Success criteria

- Learner glances at the board and sees **≤ a few** circled apply-units, each with a remember/apply note.
- Circles sit on the **correct** words every time (DOM-validated).
- When a diagram appears, it sits in **empty** gutter space aligned with the talk track — **no overlap** with passage or tip chips.
- On physics-appropriate topics, a real VFPt figure can appear (same corpus as Physics Tutor).
- On general topics, a Smart-style tldraw sketch can appear when structure helps.
- Recall questions feel like exam/application prompts, not trivia about headings.
- A student can complete a full Voice lesson without opening `/smart-tutor` or `/smart-tutor/physics-tutor` for diagrams.

---

## 13. Open implementation choices (decide in Phase 2, not blockers for Phase 1)

1. **Sketch card renderer:** embedded read-only tldraw vs snapshot image vs Konva projection of `ExperimentShape[]` — fidelity vs bundle weight.
2. **Mobile:** gutter below the text stack vs hide diagrams until “show figure” voice command.
3. **Score threshold** for VFPt “closest match” vs “no diagram.”
4. Whether multi-annotation ships before or with the first gutter diagram host (prefer circling first).

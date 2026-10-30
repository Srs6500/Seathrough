import assert from "node:assert/strict";
import {
  coerceLessonScript,
  formatRuntime,
  INCOMPLETE_SCRIPT,
  lessonScriptSchema,
} from "../src/lib/course-creator/script";
import { getMode } from "../src/modes/registry";

assert.equal(getMode("course-creator")?.href, "/smart-tutor");
assert.equal(getMode("course-creator")?.enabled, false);

assert.throws(() => coerceLessonScript({}), (err: Error) => {
  assert.equal(err.message, INCOMPLETE_SCRIPT);
  return true;
});

assert.throws(
  () =>
    coerceLessonScript({
      title: "Too thin",
      beats: [
        { heading: "A", visual: "box", voiceover: "hello there everyone now" },
        { heading: "B", visual: "box", voiceover: "hello there everyone now" },
        { heading: "C", visual: "box", voiceover: "hello there everyone now" },
      ],
    }),
  (err: Error) => err.message === INCOMPLETE_SCRIPT,
);

const script = coerceLessonScript({
  title: "HTTPS in plain sight",
  hook: "A lock icon is not magic. It is a handshake.",
  audience: "people who browse the web",
  scenes: [
    {
      title: "The lock",
      see: "A browser bar with an open lock that clicks shut.",
      speak: "That lock means the page proved who it is, then wrapped what you type.",
      caption: "lock = identity + wrap",
      seconds: 18,
    },
    {
      heading: "The handshake",
      visual: "Two keys swap, then a shared padlock appears.",
      voiceover: "Your browser and the site agree on a secret without saying the secret out loud.",
      seconds: 22,
    },
    {
      heading: "What is wrapped",
      visual: "A password flies, then a sealed envelope replaces it.",
      voiceover: "The password leaves your machine already wrapped, so a spy on the wire cannot read it.",
    },
    {
      heading: "What it is not",
      visual: "The sealed envelope sits on a labeled server that is still visible.",
      voiceover: "HTTPS does not hide the site from the server. It hides the trip between you and them.",
      onScreen: "wraps the trip",
      duration: 30,
    },
  ],
});

assert.equal(script.title, "HTTPS in plain sight");
assert.equal(script.beats.length, 4);
assert.equal(script.beats[0]?.heading, "The lock");
assert.equal(script.beats[0]?.onScreen, "lock = identity + wrap");
assert.equal(script.beats[1]?.seconds, 22);
assert.equal(script.beats[2]?.seconds, 20);
assert.equal(script.runtimeSeconds, 18 + 22 + 20 + 30);
assert.equal(formatRuntime(script.runtimeSeconds), "about 2 min");
assert.equal(lessonScriptSchema.safeParse(script).success, true);

const skipped = coerceLessonScript({
  title: "Skip empty rows",
  hook: "Keep only complete beats.",
  audience: "beginners",
  beats: [
    { heading: "One", visual: "A", voiceover: "First complete spoken line is here now." },
    { heading: "Nope", visual: "", voiceover: "missing picture" },
    { heading: "Two", visual: "B", voiceover: "Second complete spoken line is here now." },
    { heading: "Three", visual: "C", voiceover: "Third complete spoken line is here now." },
    { heading: "Four", visual: "D", voiceover: "Fourth complete spoken line is here now." },
  ],
});
assert.equal(skipped.beats.length, 4);
assert.ok(!skipped.beats.some((beat) => beat.heading === "Nope"));

console.log("smoke-course-creator: ok", {
  title: script.title,
  beats: script.beats.length,
  runtime: formatRuntime(script.runtimeSeconds),
});

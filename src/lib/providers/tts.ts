import { getDeepgramConfig } from "@/lib/env";
import {
  deepgramPhonetics,
  speakMathDynamically,
} from "@/lib/math/dynamicMathSpeech";
import { mathToSpeech } from "@/lib/math/mathToSpeech";
import { physicsToSpeech } from "@/lib/physics-tutor/physicsToSpeech";

export type TtsResult = {
  mimeType: string;
  base64: string;
};

/** Prefer SRE when the line has TeX / unicode math / calculus spellings. */
function prefersDynamicMath(text: string): boolean {
  return /\$|\\\(|\\\[|\\begin\{|\\frac|\\int|\\sum|\\sqrt|\\partial|\\nabla|\\mu|\\pi|\\theta|[πμθε∫∂∇√∞]|\bd[a-zA-Z]?\s*\/\s*d[a-zA-Z]/.test(
    text,
  );
}

/**
 * Deepgram Aura-2 TTS. Captions stay as written; only this path rewrites math.
 * Structured math → Temml + Speech Rule Engine (ClearSpeak); else legacy mathToSpeech.
 * Thin Deepgram phonetics (mu→mew, pi→pie) always; physics mode adds domain phrasing.
 */
export async function synthesizeSpeech(
  text: string,
  options?: { mode?: "tutor" | "physics" },
): Promise<TtsResult> {
  let spoken = "";
  if (prefersDynamicMath(text)) {
    try {
      spoken = await speakMathDynamically(text);
    } catch (error) {
      console.warn(
        "[tts] dynamic math speech failed; using legacy rewriter",
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (!spoken) {
    spoken = deepgramPhonetics(mathToSpeech(text));
  }
  if (options?.mode === "physics") {
    spoken = physicsToSpeech(spoken);
  }
  if (!spoken) {
    throw new Error("TTS text is empty");
  }

  const { apiKey, model } = getDeepgramConfig();
  const url = new URL("https://api.deepgram.com/v1/speak");
  url.searchParams.set("model", model);
  url.searchParams.set("encoding", "mp3");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: spoken }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Deepgram TTS failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    mimeType: "audio/mpeg",
    base64: buffer.toString("base64"),
  };
}

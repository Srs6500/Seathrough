import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import { parseRepairedCode } from "@/lib/scene-explain/parseProgram";
import { REPAIR_SYSTEM } from "@/lib/scene-explain/prompts";
import type { SceneRepairInput } from "@/lib/scene-explain/types";

export async function repairSceneCode(input: SceneRepairInput): Promise<string> {
  const code = input.code.trim();
  const error = input.error.trim();
  if (!code) throw new Error("Scene code is required");
  if (!error) throw new Error("Crash details are required");

  const { apiKey, model, baseURL } = getLlmConfig();
  const client = getTrackedOpenAI({ apiKey, baseURL });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 9000,
    messages: [
      { role: "system", content: REPAIR_SYSTEM },
      {
        role: "user",
        content: [
          `Prompt: ${input.prompt.slice(0, 400)}`,
          `Title: ${input.title}`,
          `Repair attempt: ${input.attempt}`,
          `Runtime/crash error:\n${error.slice(0, 1200)}`,
          `Current code:\n${code.slice(0, 40_000)}`,
        ].join("\n\n"),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const next = parseRepairedCode(raw, input.title);
  return next;
}

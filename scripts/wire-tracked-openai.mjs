import { readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import path from "path";

const root = path.join(process.cwd(), "src");
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
}

walk(root);

let changed = 0;
for (const file of files) {
  let text = readFileSync(file, "utf8");
  if (!text.includes("new OpenAI(")) continue;
  // Don't rewrite the tracked wrapper itself.
  if (file.endsWith(`${path.sep}trackedOpenAI.ts`)) continue;

  const next = text.replace(/\bnew OpenAI\(/g, "getTrackedOpenAI(");
  if (next === text) continue;

  text = next;
  if (!text.includes('from "@/lib/llm/trackedOpenAI"')) {
    if (/import\s+OpenAI\s+from\s+"openai";/.test(text)) {
      text = text.replace(
        /import\s+OpenAI\s+from\s+"openai";/,
        'import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";',
      );
    } else if (/from\s+"openai"/.test(text)) {
      text = `import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";\n${text}`;
    } else {
      text = `import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";\n${text}`;
    }
  }

  // If OpenAI type is still referenced, keep a type-only import.
  if (/\bOpenAI\b/.test(text) && !/import\s+OpenAI\s+from\s+"openai"/.test(text) && !/import\s+type\s+OpenAI/.test(text) && !/import\s+\{\s*[^}]*\bOpenAI\b/.test(text)) {
    if (text.includes("OpenAI.")) {
      text = text.replace(
        'import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";',
        'import type OpenAI from "openai";\nimport { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";',
      );
    }
  }

  writeFileSync(file, text);
  changed += 1;
  console.log(path.relative(process.cwd(), file));
}

console.log(`updated ${changed} files`);

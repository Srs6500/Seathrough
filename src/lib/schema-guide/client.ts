import type {
  BackendAskResult,
  SchemaAskResult,
  SchemaGuide,
  UploadedFile,
} from "@/lib/schema-guide/types";

export async function analyzeSchema(input: {
  files?: UploadedFile[];
  demo?: boolean;
  fullName?: string;
}): Promise<SchemaGuide> {
  const response = await fetch("/api/schema-guide/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    guide?: SchemaGuide;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Analyze failed (${response.status}).`);
  }
  if (!body?.guide) throw new Error("Analyze finished without a guide.");
  return body.guide;
}

export async function askBackend(
  question: string,
  guide: SchemaGuide,
): Promise<BackendAskResult> {
  const response = await fetch("/api/schema-guide/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ question, guide, scope: "backend" }),
  });
  const body = (await response.json().catch(() => null)) as
    | (BackendAskResult & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error || `Ask failed (${response.status}).`);
  }
  if (!body?.answer) throw new Error("No answer came back.");
  return body;
}

export async function askSchema(
  question: string,
  guide: SchemaGuide,
): Promise<SchemaAskResult> {
  const response = await fetch("/api/schema-guide/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ question, guide }),
  });
  const body = (await response.json().catch(() => null)) as
    | (SchemaAskResult & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(body?.error || `Ask failed (${response.status}).`);
  }
  if (!body?.answer) throw new Error("No answer came back.");
  return body;
}

export async function readLocalFiles(list: FileList | File[]): Promise<UploadedFile[]> {
  const files = Array.from(list);
  const out: UploadedFile[] = [];
  for (const file of files) {
    const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    if (!/\.(prisma|ts|tsx|js|jsx)$/i.test(path)) continue;
    if (/(^|\/)(node_modules|\.git|\.next|dist|build)(\/|$)/i.test(path)) continue;
    if (file.size > 80_000) continue;
    const content = await file.text();
    out.push({ path, content });
  }
  return out;
}

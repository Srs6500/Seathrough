import { resolveImportPath } from "@/lib/data-flow/nextIndex";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type { RepoIndex } from "@/lib/data-flow/types";
import type { FrontendArchFinding } from "@/lib/frontend-arch/types";

function lineOf(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function snippetAround(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n");
  const from = Math.max(0, startLine - 1);
  const to = Math.min(lines.length, endLine);
  return lines.slice(from, to).join("\n").slice(0, 320);
}

/**
 * Deterministic static checks on frontend-ish files (no LLM, no browser).
 */
export function findStaticFrontendProblems(input: {
  files: RepoSourceFile[];
  index: RepoIndex;
  pathToNodeId: Map<string, string>;
}): FrontendArchFinding[] {
  const { files, index, pathToNodeId } = input;
  const findings: FrontendArchFinding[] = [];
  let seq = 0;
  const nextId = (prefix: string) => {
    seq += 1;
    return `${prefix}-${seq}`;
  };

  const pathSet = new Set(files.map((f) => f.path));
  const pageRoutes = new Set(
    index.symbols.filter((s) => s.kind === "page" && s.route).map((s) => s.route!),
  );
  const apiRoutes = new Set(
    index.symbols.filter((s) => s.kind === "api" && s.route).map((s) => s.route!),
  );

  for (const file of files) {
    if (!/\.(tsx|jsx|ts|js)$/.test(file.path) || file.path.endsWith(".d.ts")) {
      continue;
    }
    // Focus on UI / app code
    if (
      !/(^|\/)(app|pages|components|src\/components|src\/app|features|ui)\//.test(
        file.path,
      ) &&
      !/\.(tsx|jsx)$/.test(file.path)
    ) {
      continue;
    }

    const content = file.content;
    const nodeId = pathToNodeId.get(file.path);

    // --- Unresolved local imports ---
    const importRe =
      /import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
    let im: RegExpExecArray | null;
    while ((im = importRe.exec(content)) !== null) {
      const spec = im[1]!;
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      // CSS/assets aren't in the TS path index — not a broken component import
      if (/\.(css|scss|sass|less|svg|png|jpe?g|gif|webp)$/i.test(spec)) continue;
      const resolved = resolveImportPath(file.path, spec, pathSet);
      if (resolved) continue;
      const line = lineOf(content, im.index);
      findings.push({
        id: nextId("import"),
        category: "component_connections",
        severity: "error",
        verification: "confirmed",
        title: "Unresolved import",
        summary: `Cannot resolve module "${spec}" from this file.`,
        nodeId,
        path: file.path,
        startLine: line,
        endLine: line,
        snippet: snippetAround(content, line, line),
        suggestedFix: `Create the missing module or fix the import path for "${spec}".`,
      });
    }

    // --- Empty / no-op event handlers ---
    const emptyHandlerRe =
      /\b(onClick|onSubmit|onChange|onPress)\s*=\s*\{\s*(?:\(\s*[^)]*\s*\)\s*=>\s*\{\s*\}|function\s*\([^)]*\)\s*\{\s*\})\s*\}/g;
    let eh: RegExpExecArray | null;
    while ((eh = emptyHandlerRe.exec(content)) !== null) {
      const line = lineOf(content, eh.index);
      findings.push({
        id: nextId("handler"),
        category: "buttons_and_forms",
        severity: "error",
        verification: "confirmed",
        title: `Empty ${eh[1]} handler`,
        summary: `${eh[1]} is defined but does nothing.`,
        nodeId,
        path: file.path,
        startLine: line,
        endLine: line,
        snippet: snippetAround(content, line, line + 2),
        suggestedFix: `Wire ${eh[1]} to the intended action (API call, navigation, or state update).`,
      });
    }

    // --- onSubmit / handleSubmit that never calls fetch/router/action ---
    const handlerFnRe =
      /(?:async\s+)?function\s+(onSubmit|handleSubmit)\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
    let hf: RegExpExecArray | null;
    while ((hf = handlerFnRe.exec(content)) !== null) {
      const body = hf[2] || "";
      const line = lineOf(content, hf.index);
      const callsSomething =
        /\b(fetch|axios|router\.(push|replace)|redirect|mutate|action|supabase|prisma)\b/.test(
          body,
        );
      const onlyPreventDefault =
        /preventDefault/.test(body) &&
        !callsSomething &&
        body.replace(/\/\/.*$/gm, "").trim().length < 80;
      if (!callsSomething || onlyPreventDefault) {
        findings.push({
          id: nextId("submit"),
          category: "buttons_and_forms",
          severity: "error",
          verification: onlyPreventDefault ? "confirmed" : "suspected",
          title: `${hf[1]} does not call an API or navigation`,
          summary:
            "Submit handler never invokes fetch, a server action, or a router transition.",
          nodeId,
          path: file.path,
          startLine: line,
          endLine: Math.min(line + 12, content.split("\n").length),
          snippet: snippetAround(content, line, line + 12),
          suggestedFix:
            "Connect the submit handler to the authentication/API action and handle its result (loading + error).",
        });
      }
    }

    // --- fetch /api that has no matching route ---
    const fetchRe =
      /fetch\(\s*[`'"](\/api\/[^`'"]+)[`'"]/g;
    let fr: RegExpExecArray | null;
    while ((fr = fetchRe.exec(content)) !== null) {
      const route = fr[1]!.split("?")[0]!;
      const exists =
        apiRoutes.has(route) ||
        [...apiRoutes].some(
          (r) => route.startsWith(r + "/") || r.startsWith(route),
        );
      if (exists) continue;
      const line = lineOf(content, fr.index);
      findings.push({
        id: nextId("api"),
        category: "api_integration",
        severity: "error",
        verification: "confirmed",
        title: "API call has no matching route",
        summary: `Calls ${route}, but no matching app/api or pages/api route was found.`,
        nodeId,
        path: file.path,
        startLine: line,
        endLine: line,
        snippet: snippetAround(content, line, line),
        suggestedFix: `Add a route handler for ${route}, or point fetch at an existing API path.`,
      });
    }

    // --- fetch without catch / .catch ---
    const fetchBlockRe =
      /await\s+fetch\([^;]+;/g;
    let fb: RegExpExecArray | null;
    while ((fb = fetchBlockRe.exec(content)) !== null) {
      const window = content.slice(
        Math.max(0, fb.index - 120),
        fb.index + fb[0].length + 200,
      );
      if (/\.catch\s*\(|try\s*\{[\s\S]*fetch/.test(window)) continue;
      // Only flag if surrounding function has no try
      const before = content.slice(Math.max(0, fb.index - 400), fb.index);
      if (/try\s*\{[\s\S]*$/.test(before) && !/\}\s*catch/.test(window)) {
        // inside try without nearby catch in window — still check wider
      }
      const fnStart = before.lastIndexOf("function");
      const slice = content.slice(
        fnStart >= 0 ? Math.max(0, fb.index - (before.length - fnStart)) : Math.max(0, fb.index - 300),
        fb.index + 350,
      );
      if (/\btry\b[\s\S]*\bfetch\b[\s\S]*\bcatch\b/.test(slice)) continue;
      if (/\.catch\s*\(/.test(slice)) continue;
      const line = lineOf(content, fb.index);
      findings.push({
        id: nextId("apierr"),
        category: "api_integration",
        severity: "warning",
        verification: "suspected",
        title: "Fetch without visible error handling",
        summary: "API request may fail without a catch or error UI path nearby.",
        nodeId,
        path: file.path,
        startLine: line,
        endLine: line,
        snippet: snippetAround(content, line, line + 4),
        suggestedFix:
          "Wrap the request in try/catch (or .catch) and surface a user-visible error state.",
      });
    }

    // --- Broken internal hrefs ---
    const hrefRe = /(?:href|pathname)=\{?[`'"](\/[^`'"]+)[`'"]/g;
    let hr: RegExpExecArray | null;
    while ((hr = hrefRe.exec(content)) !== null) {
      const href = hr[1]!.split("?")[0]!.split("#")[0]!;
      if (href.startsWith("/api/")) continue;
      if (pageRoutes.has(href)) continue;
      // dynamic segments — skip soft matches
      if (href.includes("[")) continue;
      const soft = [...pageRoutes].some(
        (r) => r.replace(/:\w+/g, "[id]") === href || href.startsWith(r + "/"),
      );
      if (soft) continue;
      const line = lineOf(content, hr.index);
      findings.push({
        id: nextId("nav"),
        category: "navigation",
        severity: "error",
        verification: "confirmed",
        title: "Link to missing page",
        summary: `Navigates to ${href}, but no matching page route was indexed.`,
        nodeId,
        path: file.path,
        startLine: line,
        endLine: line,
        snippet: snippetAround(content, line, line),
        suggestedFix: `Add app${href === "/" ? "" : href}/page.tsx (or fix the href).`,
      });
    }

    // --- img missing alt ---
    const imgRe = /<img\b([^>]*?)>/g;
    let ig: RegExpExecArray | null;
    while ((ig = imgRe.exec(content)) !== null) {
      const attrs = ig[1] || "";
      if (/\balt\s*=/.test(attrs)) continue;
      const line = lineOf(content, ig.index);
      findings.push({
        id: nextId("a11y"),
        category: "accessibility",
        severity: "warning",
        verification: "confirmed",
        title: "Image missing alt",
        summary: "img element has no alt attribute.",
        nodeId,
        path: file.path,
        startLine: line,
        endLine: line,
        snippet: snippetAround(content, line, line),
        suggestedFix: 'Add a meaningful alt attribute, or alt="" if decorative.',
      });
    }

    // --- input without nearby label / aria-label ---
    const inputRe = /<input\b([^>]*?)\/?>/g;
    let inp: RegExpExecArray | null;
    while ((inp = inputRe.exec(content)) !== null) {
      const attrs = inp[1] || "";
      if (/\btype\s*=\s*['"]hidden['"]/.test(attrs)) continue;
      if (/\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs)) {
        continue;
      }
      if (/\bid\s*=\s*['"]([^'"]+)['"]/.test(attrs)) {
        const id = attrs.match(/\bid\s*=\s*['"]([^'"]+)['"]/)?.[1];
        if (id && new RegExp(`htmlFor\\s*=\\s*['"]${id}['"]|<label[^>]*htmlFor`).test(content)) {
          continue;
        }
      }
      // placeholder-only is weak a11y
      const line = lineOf(content, inp.index);
      const nearby = content.slice(Math.max(0, inp.index - 80), inp.index);
      if (/<label[\s>]/i.test(nearby)) continue;
      findings.push({
        id: nextId("label"),
        category: "accessibility",
        severity: "warning",
        verification: "suspected",
        title: "Input may lack a label",
        summary: "No associated label, aria-label, or nearby <label> was found.",
        nodeId,
        path: file.path,
        startLine: line,
        endLine: line,
        snippet: snippetAround(content, line, line),
        suggestedFix:
          "Associate a <label htmlFor=…> or add aria-label on the input.",
      });
    }
  }

  // Cap noise
  return findings.slice(0, 40);
}

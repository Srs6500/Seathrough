import ts from "typescript";
import { isBrandStyle } from "@/lib/vibe-coder/inspectReuse";
import type {
  ActionKind,
  DataOrigin,
  InspectKind,
  InspectNote,
  InspectStates,
  InspectTarget,
} from "@/lib/vibe-coder/inspectTypes";

const INTERACTIVE = new Set(["button", "a", "input", "textarea", "select", "form", "img"]);
const LAYOUT = new Set(["nav", "header", "aside", "main", "section", "article"]);

export type InspectWalk = {
  route: string;
  pageName: string;
  targets: InspectTarget[];
  seq: number;
};

export function fileStates(text: string): InspectStates {
  return {
    loading: /\b(loading|pending|streaming|isLoading|busy)\b/.test(text),
    empty: /\b(empty|length\s*===?\s*0|no\s+matters|nothing)\b/i.test(text),
    error: /\b(error|failed|catch\s*\()/.test(text),
    success: /\b(success|saved|done|resolved)\b/.test(text),
    disabled: /\bdisabled\s*=/.test(text),
  };
}

export function shouldInspect(tag: string, className: string): boolean {
  const lower = tag.toLowerCase();
  if (INTERACTIVE.has(lower)) return true;
  if (LAYOUT.has(lower)) return true;
  if (/^h[1-3]$/.test(lower)) return true;
  if (/\b(border|shadow|rounded|card|rail)\b/.test(className) && /\b(p-|px-|py-|p\d)/.test(className)) {
    return true;
  }
  return false;
}

function kindOf(tag: string, className: string): InspectKind {
  const lower = tag.toLowerCase();
  if (lower === "button") return "button";
  if (lower === "a") return "link";
  if (lower === "input" || lower === "textarea" || lower === "select") return "input";
  if (lower === "form") return "form";
  if (lower === "nav" || lower === "header") return "nav";
  if (lower === "img") return "image";
  if (/^h[1-3]$/.test(lower)) return "heading";
  if (/\b(border|shadow|card)\b/.test(className)) return "card";
  return "layout";
}

function attrExpr(open: ts.JsxOpeningLikeElement, name: string): ts.Expression | undefined {
  for (const attr of open.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    if (attr.name.text !== name) continue;
    if (!attr.initializer) return undefined;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer;
    if (ts.isJsxExpression(attr.initializer)) return attr.initializer.expression;
  }
  return undefined;
}

function attrText(open: ts.JsxOpeningLikeElement, name: string): string {
  const expr = attrExpr(open, name);
  if (!expr) return "";
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return expr.getText();
}

function looksApi(text: string): boolean {
  return /\b(fetch|axios|useActionState|loginAction|logoutAction|streamChat|propose|resolveAction|prisma|supabase|\/api\/)\b/.test(
    text,
  );
}

function looksNav(text: string): boolean {
  return /\b(href|router\.(push|replace)|redirect|Link|navigate)\b/.test(text);
}

function looksState(text: string): boolean {
  return /\b(set[A-Z]\w+|useState|onSelect|setSelected)\b/.test(text);
}

function handlerBody(expr: ts.Expression | undefined, source: ts.SourceFile): string {
  if (!expr) return "";
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return expr.body.getText();
  }
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    for (const stmt of source.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
        return stmt.body?.getText() ?? "";
      }
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
            if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
              return decl.initializer.body.getText();
            }
          }
        }
      }
    }
    return name;
  }
  return expr.getText();
}

function actionOf(
  tag: string,
  open: ts.JsxOpeningLikeElement,
  source: ts.SourceFile,
): { kind: ActionKind; detail: string } {
  const href = attrText(open, "href");
  if (href) {
    return { kind: "navigate", detail: `Goes to ${href}.` };
  }
  const type = attrText(open, "type").replace(/['"]/g, "");
  const onClick = attrExpr(open, "onClick");
  const onSubmit = attrExpr(open, "onSubmit");
  const formAction = attrExpr(open, "formAction") ?? attrExpr(open, "action");
  const clickBody = handlerBody(onClick, source);
  const submitBody = handlerBody(onSubmit, source);
  const actionBody = handlerBody(formAction, source);

  if (formAction) {
    if (looksApi(actionBody) || /Action$/.test(actionBody) || /formAction|loginAction|logoutAction/.test(actionBody)) {
      return { kind: "api", detail: `Runs ${actionBody.slice(0, 80) || "a server action"}.` };
    }
    return { kind: "submit", detail: "Submits this form." };
  }
  if (tag === "form" || type === "submit") {
    if (looksApi(submitBody) || looksApi(clickBody) || looksApi(source.getText())) {
      return { kind: "api", detail: "Submits the form, which runs a server action or API." };
    }
    if (onSubmit || type === "submit") {
      return { kind: "submit", detail: "Submits the nearest form." };
    }
  }
  if (onClick) {
    if (looksNav(clickBody)) return { kind: "navigate", detail: "Click navigates to another route." };
    if (looksApi(clickBody)) return { kind: "api", detail: "Click starts a request." };
    if (looksState(clickBody)) return { kind: "state", detail: "Click only updates local state." };
    if (/^\s*\{\s*\}\s*$/.test(clickBody) || clickBody.trim() === "") {
      return { kind: "none", detail: "Click handler is empty." };
    }
    return { kind: "state", detail: `Click runs ${clickBody.slice(0, 72)}.` };
  }
  if (tag === "button" && type !== "submit") {
    return { kind: "none", detail: "No click, submit, or navigation is attached." };
  }
  if (tag === "a") return { kind: "navigate", detail: "Link with no href found." };
  return { kind: "none", detail: "No behavior is attached in this file." };
}

function originOf(
  open: ts.JsxOpeningLikeElement,
  inner: string,
  sourceText: string,
): { origin: DataOrigin; detail: string } {
  const value = attrText(open, "value") || attrText(open, "defaultValue");
  if (/DEMO_|fixture|mock|sample/i.test(sourceText) && /\$|revenue|counsel|demo/i.test(inner + value)) {
    return { origin: "mock", detail: "Copy comes from demo or fixture data in the repo." };
  }
  if (/\b(fetch|prisma|getSession|getMatters|streamChat|\/api\/)\b/.test(sourceText) && /\{[A-Za-z.]+\w\}/.test(sourceText)) {
    if (/\b(matter|session|user|result|artifact)\./.test(sourceText)) {
      return { origin: "api", detail: "Values are filled from session, queries, or API results." };
    }
  }
  const tag = open.tagName.getText().toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (value && !/\{/.test(value) && !/placeholder/i.test(value)) {
      return { origin: "hardcoded", detail: `Default value is written in source: “${value.slice(0, 60)}”.` };
    }
    return { origin: "user", detail: "This field is typed by the person using the page." };
  }
  const childrenAreLiteral = !/\{/.test(inner) && inner.trim().length > 0;
  if (childrenAreLiteral || /^\$?\d[\d,]*$/.test(inner.trim())) {
    return { origin: "hardcoded", detail: `Hardcoded in the component: “${inner.trim().slice(0, 60)}”.` };
  }
  if (inner.trim()) {
    return { origin: "unknown", detail: "Shown from a variable; the source is not a literal string." };
  }
  return { origin: "unknown", detail: "No visible value is set in the markup." };
}

function styleTokens(className: string): string[] {
  return className
    .split(/\s+/)
    .filter((cls) =>
      /^(text-|bg-|border-|font-|tracking-|shadow-|max-w-|w-|min-w-|overflow-|flex|grid|hidden|sm:|md:|lg:)/.test(cls),
    )
    .slice(0, 8);
}

function notesFor(input: {
  id: string;
  kind: InspectKind;
  tag: string;
  className: string;
  text: string;
  action: ActionKind;
  actionDetail: string;
  origin: DataOrigin;
  states: InspectStates;
  hasAlt: boolean;
  hasLabel: boolean;
}): InspectNote[] {
  const notes: InspectNote[] = [];
  const add = (area: InspectNote["area"], title: string, detail: string, next: string) => {
    notes.push({
      id: `${input.id}-${area}-${notes.length}`,
      area,
      title,
      detail,
      next,
    });
  };

  if (input.kind === "button" && input.action === "none") {
    add(
      "function",
      "This control does nothing",
      input.actionDetail,
      "Attach navigation, a state update, or an API call — or remove the button.",
    );
  }
  if (input.kind === "form" && input.action === "none") {
    add(
      "function",
      "Form has no submit path",
      "The form never calls an action, fetch, or navigation.",
      "Wire onSubmit or a server action and handle loading plus errors.",
    );
  }
  if (input.origin === "hardcoded" && /\$[\d,]{2,}|\brevenue\b|\btotal\b|\b12,?450\b/i.test(input.text)) {
    add(
      "data",
      "Number is hardcoded",
      input.text.trim()
        ? `“${input.text.trim()}” is written into the component, not loaded from your backend.`
        : "This figure is a literal in source.",
      "Connect an endpoint and define loading and error for this value.",
    );
  }
  if (input.origin === "mock") {
    add(
      "data",
      "Demo data only",
      "This copy comes from a demo constant, not a live request.",
      "Keep it labeled as demo, or replace it with an API value.",
    );
  }
  if ((input.kind === "card" || input.kind === "heading") && !input.states.loading && !input.states.error) {
    add(
      "data",
      "No loading or error state",
      "The happy path is the only path in this file.",
      "Add what people see while data loads and when the request fails.",
    );
  }
  if (/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]|w-\d{3,}\b/.test(input.className)) {
    add(
      "layout",
      "Fixed width",
      "A hard width can overflow or leave empty space on smaller screens.",
      "Switch to max-width and let the layout shrink.",
    );
  }
  if (/\boverflow-hidden\b/.test(input.className) && /\bw-|max-w-/.test(input.className)) {
    add(
      "layout",
      "Overflow is clipped",
      "overflow-hidden will hide content instead of wrapping or scrolling.",
      "Check long labels at mobile width before changing copy.",
    );
  }
  if (!/\b(sm:|md:|lg:|xl:)/.test(input.className) && (input.kind === "nav" || input.kind === "card" || input.kind === "layout")) {
    add(
      "responsive",
      "No breakpoint classes",
      "This block uses one layout for every width.",
      "Open mobile width and decide what should stack or hide.",
    );
  }
  if (input.kind === "image" && !input.hasAlt) {
    add(
      "a11y",
      "Image has no alt text",
      "Screen readers cannot describe this image.",
      "Add alt that says what the image is for.",
    );
  }
  if (input.kind === "input" && !input.hasLabel) {
    add(
      "a11y",
      "Field may be unlabeled",
      "No label or aria-label was found next to this input.",
      "Wrap it in a label or add aria-label.",
    );
  }
  if (input.kind === "button" && !input.text.trim()) {
    add(
      "a11y",
      "Button has no name",
      "An empty button is hard to use with a keyboard or reader.",
      "Put a visible label or aria-label on the control.",
    );
  }
  if (/\.(png|jpg|jpeg|webp|gif)\b/i.test(input.className + input.text) || input.kind === "image") {
    add(
      "performance",
      "Image cost is not measured live",
      "From source we can see an image, not its byte size on the network.",
      "Compress it and set width/height (or use the framework image helper).",
    );
  }
  return notes;
}

function prettyName(kind: InspectKind, text: string, component: string, tag: string): string {
  const clean = text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
  if (clean && clean.length < 40) {
    if (kind === "button") return `${clean} button`;
    if (kind === "heading") return clean;
    return clean;
  }
  if (component && component !== "default") return component.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (kind === "nav") return "Navigation";
  if (kind === "form") return "Form";
  if (kind === "card") return "Card";
  return tag;
}

function snippetAround(text: string, line: number): string {
  const lines = text.split("\n");
  const from = Math.max(0, line - 1);
  const to = Math.min(lines.length, line + 6);
  return lines.slice(from, to).join("\n").slice(0, 400);
}

export function recordInspectTarget(input: {
  walk: InspectWalk;
  open: ts.JsxOpeningLikeElement;
  tag: string;
  className: string;
  innerText: string;
  file: string;
  source: ts.SourceFile;
  sourceText: string;
  component: string;
}): InspectTarget | null {
  if (!shouldInspect(input.tag, input.className)) return null;
  input.walk.seq += 1;
  const id = `st-${input.walk.seq}`;
  const start = input.source.getLineAndCharacterOfPosition(input.open.getStart(input.source));
  const line = start.line + 1;
  const kind = kindOf(input.tag, input.className);
  const action = actionOf(input.tag, input.open, input.source);
  const origin = originOf(input.open, input.innerText, input.sourceText);
  const states = fileStates(input.sourceText);
  const hasAlt = Boolean(attrText(input.open, "alt"));
  const hasLabel =
    Boolean(attrText(input.open, "aria-label")) ||
    Boolean(attrText(input.open, "placeholder")) ||
    /<label[\s>]/.test(input.sourceText);
  const name = prettyName(kind, input.innerText, input.component, input.tag);
  const attention = notesFor({
    id,
    kind,
    tag: input.tag,
    className: input.className,
    text: input.innerText,
    action: action.kind,
    actionDetail: action.detail,
    origin: origin.origin,
    states,
    hasAlt,
    hasLabel,
  });
  const missing = [
    !states.loading ? "loading" : "",
    !states.error ? "error" : "",
    !states.empty ? "empty" : "",
  ].filter(Boolean);

  const nextStep =
    attention[0]?.next ||
    (action.kind === "none" && kind === "button"
      ? "Give this button a real action, or remove it."
      : "Read the source, then decide what should change.");

  const target: InspectTarget = {
    id,
    name,
    kind,
    tag: input.tag,
    route: input.walk.route,
    file: input.file,
    startLine: line,
    endLine: line,
    component: input.component,
    className: input.className,
    text: input.innerText.replace(/\s+/g, " ").trim().slice(0, 120),
    what: {
      summary: `${name} in ${input.component || "this page"}.`,
      styles: styleTokens(input.className),
      content: input.innerText.replace(/\s+/g, " ").trim().slice(0, 160) || "No text node.",
      origin: origin.origin,
      originDetail: origin.detail,
    },
    how: {
      action: action.kind,
      actionDetail: action.detail,
      usedOn: [input.walk.pageName],
      sharedWith: [],
      states,
    },
    attention,
    nextStep:
      missing.length && (kind === "card" || kind === "heading")
        ? `Connect real data and define what appears for ${missing.join(" and ")}.`
        : nextStep,
    snippet: snippetAround(input.sourceText, line),
  };
  input.walk.targets.push(target);
  return target;
}

export function mergeUsage(targets: InspectTarget[]): InspectTarget[] {
  const byComponent = new Map<string, Set<string>>();
  const byToken = new Map<string, Set<string>>();
  for (const target of targets) {
    const key = `${target.file}::${target.component}`;
    if (!byComponent.has(key)) byComponent.set(key, new Set());
    byComponent.get(key)!.add(target.route);
    for (const token of target.what.styles.filter((cls) => isBrandStyle(cls))) {
      if (!byToken.has(token)) byToken.set(token, new Set());
      byToken.get(token)!.add(target.route);
    }
  }
  return targets.map((target) => {
    const pages = [...(byComponent.get(`${target.file}::${target.component}`) ?? [])];
    const shared = target.what.styles
      .filter((cls) => (byToken.get(cls)?.size ?? 0) > 1)
      .slice(0, 4);
    return {
      ...target,
      how: {
        ...target.how,
        usedOn: pages.length ? pages : target.how.usedOn,
        sharedWith: shared,
      },
    };
  });
}

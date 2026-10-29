import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { recordInspectTarget, type InspectWalk } from "@/lib/vibe-coder/inspectBuild";
import type { InspectTarget } from "@/lib/vibe-coder/inspectTypes";
import {
  sourceNeedsLiveRuntime,
  type LiveIsland,
} from "@/lib/vibe-coder/liveIsland";
import { escapeAttr, escapeHtml } from "@/lib/vibe-coder/sourceStyles";

const SKIP_MODULES = /^(next\/|react(?:-dom)?$|prisma|@prisma|fs|path|node:)/;
const INTRINSIC = new Set([
  "a", "abbr", "aside", "b", "button", "circle", "clipPath", "code", "defs", "div",
  "em", "ellipse", "fieldset", "figcaption", "figure", "footer", "form", "g",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "input", "label",
  "li", "line", "linearGradient", "main", "nav", "ol", "option", "p", "path",
  "polygon", "polyline", "pre", "rect", "section", "select", "small", "span",
  "stop", "strong", "sub", "sup", "svg", "table", "tbody", "td", "textarea", "th",
  "thead", "tr", "ul", "video", "source",
]);

const VOID_HTML = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

function htmlElement(tag: string, attrs: string, inspect: string, inner: string): string {
  if (VOID_HTML.has(tag)) {
    return `<${tag}${attrs}${inspect} />`;
  }
  const content = tag === "textarea" ? inner.replace(/<[^>]*>/g, "") : inner;
  return `<${tag}${attrs}${inspect}>${content}</${tag}>`;
}

type Sample = Record<string, string>;

type MapCtx = {
  item: string;
  values: Sample;
  index: number;
};

type FileModule = {
  file: string;
  source: ts.SourceFile;
  text: string;
  exports: Map<string, ts.FunctionLikeDeclaration | ts.Expression>;
  values: Map<string, unknown>;
  imports: Map<string, { spec: string; name: string }>;
};

type Ctx = {
  appRoot: string;
  modules: Map<string, FileModule>;
  aliases: Array<{ from: string; to: string }>;
  depth: number;
  map: MapCtx | null;
  props: Map<string, unknown>;
  component: string;
  inspect: InspectWalk | null;
  slots: Map<string, string>;
  islands: LiveIsland[];
};

const SAMPLES: Sample[] = [
  {
    title: "Title",
    client: "Client",
    number: "001",
    practice: "Practice",
    name: "Name",
    email: "name@firm.com",
    role: "Role",
    firm: "Firm",
    id: "one",
  },
  {
    title: "Second title",
    client: "Second client",
    number: "002",
    practice: "Practice",
    name: "Name",
    email: "name@firm.com",
    role: "Role",
    firm: "Firm",
    id: "two",
  },
];

function looksRedirect(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return node.expression.text === "redirect";
  }
  if (ts.isReturnStatement(node) && node.expression) {
    return looksRedirect(node.expression);
  }
  if (ts.isExpressionStatement(node)) return looksRedirect(node.expression);
  if (ts.isBlock(node)) return node.statements.some(looksRedirect);
  return false;
}

function isJsx(node: ts.Node | undefined): node is ts.JsxChild | ts.JsxElement | ts.JsxFragment {
  if (!node) return false;
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

function jsxCount(node: ts.Node): number {
  let count = 0;
  const visit = (current: ts.Node) => {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) count += 1;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return count;
}

function literalValue(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => (ts.isSpreadElement(el) ? [] : literalValue(el as ts.Expression)));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : "";
      if (key) obj[key] = literalValue(prop.initializer);
    }
    return obj;
  }
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return literalValue(node.expression);
  }
  return undefined;
}

function hookCalleeName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

function collectValues(source: ts.SourceFile): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const visitLit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = literalValue(node.initializer);
      if (value !== undefined) values.set(node.name.text, value);
    }
    ts.forEachChild(node, visitLit);
  };
  visitLit(source);
  const visitHook = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      hookCalleeName(node.initializer.expression) === "useState"
    ) {
      const first = node.name.elements[0];
      if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
        const arg = node.initializer.arguments[0];
        if (arg) {
          const lit =
            literalValue(arg) ??
            (ts.isIdentifier(arg) ? values.get(arg.text) : undefined);
          if (lit !== undefined) values.set(first.name.text, lit);
        }
      }
    }
    ts.forEachChild(node, visitHook);
  };
  visitHook(source);
  return values;
}

function importSpecFromCall(expr: ts.Expression): string | null {
  if (!ts.isCallExpression(expr)) return null;
  if (expr.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const arg = expr.arguments[0];
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

function dynamicImportOf(expr: ts.Expression): { spec: string; name: string } | null {
  if (!ts.isCallExpression(expr)) return null;
  if (!ts.isIdentifier(expr.expression) || expr.expression.text !== "dynamic") return null;
  const loader = expr.arguments[0];
  if (!loader || !(ts.isArrowFunction(loader) || ts.isFunctionExpression(loader))) return null;
  let body: ts.Expression | undefined = ts.isBlock(loader.body)
    ? loader.body.statements.find(ts.isReturnStatement)?.expression
    : loader.body;
  if (!body) return null;
  if (
    ts.isCallExpression(body) &&
    ts.isPropertyAccessExpression(body.expression) &&
    body.expression.name.text === "then"
  ) {
    const spec = importSpecFromCall(body.expression.expression);
    if (!spec) return null;
    const thenArg = body.arguments[0];
    let name = "default";
    if (thenArg && (ts.isArrowFunction(thenArg) || ts.isFunctionExpression(thenArg))) {
      const thenBody = thenArg.body;
      if (ts.isPropertyAccessExpression(thenBody)) name = thenBody.name.text;
    }
    return { spec, name };
  }
  const spec = importSpecFromCall(body);
  return spec ? { spec, name: "default" } : null;
}

function collectImports(source: ts.SourceFile): Map<string, { spec: string; name: string }> {
  const imports = new Map<string, { spec: string; name: string }>();
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) imports.set(clause.name.text, { spec, name: "default" });
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          imports.set(el.name.text, {
            spec,
            name: el.propertyName?.text ?? el.name.text,
          });
        }
      }
      continue;
    }
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const dynamic = dynamicImportOf(decl.initializer);
      if (dynamic) imports.set(decl.name.text, dynamic);
    }
  }
  return imports;
}

function functionFromDecl(decl: ts.VariableDeclaration): ts.FunctionLikeDeclaration | null {
  if (!decl.initializer) return null;
  if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
    return decl.initializer;
  }
  return null;
}

function collectExports(source: ts.SourceFile): Map<string, ts.FunctionLikeDeclaration | ts.Expression> {
  const exports = new Map<string, ts.FunctionLikeDeclaration | ts.Expression>();
  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      exports.set(stmt.name.text, stmt);
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        exports.set("default", stmt);
      }
    }
    if (ts.isVariableStatement(stmt)) {
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const fn = functionFromDecl(decl);
        if (fn) exports.set(decl.name.text, fn);
        else if (exported && decl.initializer) exports.set(decl.name.text, decl.initializer);
      }
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (ts.isIdentifier(stmt.expression)) {
        const local = exports.get(stmt.expression.text);
        if (local) exports.set("default", local);
        else exports.set("default", stmt.expression);
      } else if (ts.isArrowFunction(stmt.expression) || ts.isFunctionExpression(stmt.expression)) {
        exports.set("default", stmt.expression);
      }
    }
  }
  return exports;
}

async function readTsconfigAliases(appRoot: string): Promise<Array<{ from: string; to: string }>> {
  const aliases: Array<{ from: string; to: string }> = [
    { from: "@/", to: path.join(appRoot, "src") + "/" },
    { from: "@/", to: appRoot + "/" },
  ];
  for (const rel of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const raw = await readFile(path.join(appRoot, rel), "utf8");
      const paths = raw.match(/"@\/\*"\s*:\s*\[\s*"([^"]+)"/);
      if (paths?.[1]) {
        const target = paths[1].replace(/\/\*$/, "");
        aliases.unshift({ from: "@/", to: path.join(appRoot, target) + "/" });
      }
    } catch {
      /* try next */
    }
  }
  return aliases;
}

async function resolveImportFile(
  spec: string,
  fromFile: string,
  aliases: Array<{ from: string; to: string }>,
): Promise<string | null> {
  if (SKIP_MODULES.test(spec)) return null;
  if (spec.startsWith(".")) {
    return tryRead(path.resolve(path.dirname(fromFile), spec));
  }
  for (const alias of aliases) {
    if (spec.startsWith("@/")) {
      const file = await tryRead(path.join(alias.to.replace(/\/$/, ""), spec.slice(2)));
      if (file) return file;
      continue;
    }
    if (spec.startsWith(alias.from)) {
      const file = await tryRead(
        path.join(alias.to.replace(/\/$/, ""), spec.slice(alias.from.length)),
      );
      if (file) return file;
    }
  }
  return null;
}

async function tryRead(base: string): Promise<string | null> {
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ];
  for (const file of candidates) {
    try {
      await readFile(file, "utf8");
      return file;
    } catch {
      /* next */
    }
  }
  return null;
}

async function loadModule(file: string, ctx: Ctx): Promise<FileModule | null> {
  const abs = path.normalize(file);
  const hit = ctx.modules.get(abs);
  if (hit) return hit;
  let text = "";
  try {
    text = await readFile(abs, "utf8");
  } catch {
    return null;
  }
  const kind = /\.tsx$/.test(abs) ? ts.ScriptKind.TSX : /\.jsx$/.test(abs) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, kind);
  const mod: FileModule = {
    file: abs,
    source,
    text,
    exports: collectExports(source),
    values: collectValues(source),
    imports: collectImports(source),
  };
  ctx.modules.set(abs, mod);
  for (const [local, imported] of mod.imports) {
    if (mod.values.has(local)) continue;
    const depFile = await resolveImportFile(imported.spec, abs, ctx.aliases);
    if (!depFile) continue;
    const dep = await loadModule(depFile, ctx);
    if (!dep) continue;
    const value =
      dep.values.get(imported.name) ??
      (imported.name === "default" ? [...dep.values.values()][0] : undefined);
    if (value !== undefined) mod.values.set(local, value);
  }
  return mod;
}

function tagName(node: ts.JsxTagNameExpression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return "div";
}

function findJsxReturn(fn: ts.FunctionLikeDeclaration): ts.Expression | null {
  const body = fn.body;
  if (!body) return null;
  if (isJsx(body)) return body;
  if (!ts.isBlock(body)) return ts.isParenthesizedExpression(body) && isJsx(body.expression) ? body.expression : null;

  const returns: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && node !== fn) return;
    if (ts.isIfStatement(node) && looksRedirect(node.thenStatement)) {
      if (node.elseStatement) visit(node.elseStatement);
      return;
    }
    if (ts.isReturnStatement(node) && node.expression && !looksRedirect(node.expression)) {
      returns.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  const jsxReturns = returns.filter((node) => jsxCount(node) > 0);
  if (jsxReturns.length === 0) return returns.at(-1) ?? null;
  return jsxReturns.sort((a, b) => jsxCount(b) - jsxCount(a))[0] ?? null;
}

function pickTernary(cond: ts.Expression, whenTrue: ts.Expression, whenFalse: ts.Expression): ts.Expression {
  const condText = cond.getText();
  if (/error|pending|loading|streaming|disabled|unauthorized/i.test(condText)) {
    return whenFalse;
  }
  if (/length\s*===?\s*0|!\w+|===\s*null|==\s*null/.test(condText)) {
    return jsxCount(whenFalse) >= jsxCount(whenTrue) ? whenFalse : whenTrue;
  }
  return jsxCount(whenTrue) >= jsxCount(whenFalse) ? whenTrue : whenFalse;
}

function condIsOn(cond: ts.Expression, ctx: Ctx, from: FileModule): boolean {
  if (ts.isParenthesizedExpression(cond)) return condIsOn(cond.expression, ctx, from);
  if (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken) {
    return !condIsOn(cond.operand as ts.Expression, ctx, from);
  }
  if (ts.isBinaryExpression(cond)) {
    const op = cond.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return condIsOn(cond.left as ts.Expression, ctx, from) && condIsOn(cond.right, ctx, from);
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      return condIsOn(cond.left as ts.Expression, ctx, from) || condIsOn(cond.right, ctx, from);
    }
    if (
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      return condIsOn(cond.left as ts.Expression, ctx, from);
    }
  }
  if (ts.isIdentifier(cond)) {
    if (ctx.slots.has(cond.text)) return Boolean(ctx.slots.get(cond.text));
    if (ctx.props.has(cond.text)) {
      const value = ctx.props.get(cond.text);
      return value !== false && value !== null && value !== undefined && value !== "";
    }
    if (from.values.has(cond.text)) return Boolean(from.values.get(cond.text));
    return false;
  }
  const text = cond.getText();
  if (/error|pending|loading|streaming/i.test(text)) return false;
  return true;
}

function humanize(name: string): string {
  const last = name.split(".").pop() || name;
  if (last === "id") return "id";
  const spaced = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function lookupSample(name: string, ctx: Ctx): string | undefined {
  if (ctx.map && (name === ctx.map.item || name.startsWith(`${ctx.map.item}.`))) {
    const key = name.slice(ctx.map.item.length).replace(/^\./, "");
    if (!key) return undefined;
    return ctx.map.values[key] ?? ctx.map.values[key.split(".").pop() ?? ""];
  }
  const prop = ctx.props.get(name);
  if (typeof prop === "string") return prop;
  return undefined;
}

function looksSampleName(name: string): boolean {
  return /^(title|name|email|label|text|count|id|client|number|role|firm|query|value|practice)$/i.test(
    name.split(".").pop() || name,
  );
}

function textFromExpr(expr: ts.Expression, ctx: Ctx, from?: FileModule): string {
  const lit = literalValue(expr);
  if (typeof lit === "string" || typeof lit === "number") return String(lit);
  if (ts.isIdentifier(expr)) {
    const fromProp = lookupSample(expr.text, ctx);
    if (fromProp) return fromProp;
    const value = from?.values.get(expr.text);
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (looksSampleName(expr.text)) return humanize(expr.text);
    return "";
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const pathName = expr.getText().replace(/\?./g, ".");
    const sample = lookupSample(pathName, ctx);
    if (sample) return sample;
    const ident = pathName.split(".")[0] ?? "";
    const rest = pathName.slice(ident.length + 1);
    const prop = ctx.props.get(ident);
    if (prop && typeof prop === "object" && prop !== null && rest in (prop as object)) {
      const value = (prop as Record<string, unknown>)[rest];
      if (typeof value === "string" || typeof value === "number") return String(value);
    }
    return humanize(rest || pathName);
  }
  if (ts.isTemplateExpression(expr)) {
    return (
      expr.head.text +
      expr.templateSpans.map((span) => textFromExpr(span.expression, ctx, from) + span.literal.text).join("")
    );
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return textFromExpr(expr.left as ts.Expression, ctx, from) + textFromExpr(expr.right, ctx, from);
  }
  if (ts.isConditionalExpression(expr)) {
    return textFromExpr(pickTernary(expr.condition, expr.whenTrue, expr.whenFalse), ctx, from);
  }
  return "";
}

function classFromExpr(expr: ts.Expression, ctx: Ctx): string {
  const lit = literalValue(expr);
  if (typeof lit === "string") return lit;
  if (ts.isTemplateExpression(expr)) {
    const parts = [expr.head.text];
    for (const span of expr.templateSpans) {
      if (ts.isConditionalExpression(span.expression)) {
        const chosen = ctx.map?.index
          ? span.expression.whenFalse
          : span.expression.whenTrue;
        parts.push(classFromExpr(chosen, ctx));
      } else {
        parts.push(classFromExpr(span.expression, ctx));
      }
      parts.push(span.literal.text);
    }
    return parts.join("").replace(/\s+/g, " ").trim();
  }
  if (ts.isConditionalExpression(expr)) {
    return classFromExpr(pickTernary(expr.condition, expr.whenTrue, expr.whenFalse), ctx);
  }
  if (ts.isCallExpression(expr)) {
    return expr.arguments
      .map((arg) => (ts.isSpreadElement(arg) ? "" : classFromExpr(arg as ts.Expression, ctx)))
      .filter(Boolean)
      .join(" ");
  }
  if (ts.isBinaryExpression(expr)) {
    return `${classFromExpr(expr.left as ts.Expression, ctx)} ${classFromExpr(expr.right, ctx)}`.trim();
  }
  return "";
}

const UNITLESS_STYLE = new Set([
  "z-index",
  "opacity",
  "flex",
  "flex-grow",
  "flex-shrink",
  "font-weight",
  "line-height",
  "order",
  "zoom",
]);

function cssStyleValue(key: string, value: unknown): string | null {
  if (value == null || value === false) return null;
  if (typeof value === "number") {
    return UNITLESS_STYLE.has(key) ? String(value) : `${value}px`;
  }
  if (typeof value === "string") return value;
  return null;
}

function styleExprValue(
  expr: ts.Expression,
  ctx: Ctx,
  from?: FileModule,
): unknown {
  const lit = literalValue(expr);
  if (lit !== undefined) return lit;
  if (ts.isConditionalExpression(expr)) {
    const on = from ? condIsOn(expr.condition, ctx, from) : jsxCount(expr.whenTrue) >= jsxCount(expr.whenFalse);
    return styleExprValue(on ? expr.whenTrue : expr.whenFalse, ctx, from);
  }
  return undefined;
}

function styleFromExpr(expr: ts.Expression, ctx: Ctx, from?: FileModule): string {
  if (!ts.isObjectLiteralExpression(expr)) return "";
  const parts: string[] = [];
  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const extra = styleFromExpr(prop.expression, ctx, from);
      if (extra) parts.push(extra);
      continue;
    }
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const key = prop.name.text.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    const value = styleExprValue(prop.initializer, ctx, from);
    const css = cssStyleValue(key, value);
    if (css == null) continue;
    parts.push(`${key}:${css}`);
  }
  return parts.join(";");
}

const SKIP_ATTR = /^(on[A-Z].*|key|ref|suppressHydrationWarning|dangerouslySetInnerHTML|action|formAction|defaultValue)$/;

function classNameOf(element: ts.JsxOpeningLikeElement, ctx: Ctx): string {
  for (const attr of element.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    if (attr.name.text !== "className" || !attr.initializer) continue;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      return classFromExpr(attr.initializer.expression, ctx);
    }
  }
  return "";
}

function stampInspect(
  open: ts.JsxOpeningLikeElement,
  tag: string,
  inner: string,
  from: FileModule,
  ctx: Ctx,
): string {
  if (!ctx.inspect) return "";
  const className = classNameOf(open, ctx);
  const plain = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const target = recordInspectTarget({
    walk: ctx.inspect,
    open,
    tag,
    className,
    innerText: plain,
    file: from.file.replace(`${ctx.appRoot}/`, ""),
    source: from.source,
    sourceText: from.text,
    component: ctx.component,
  });
  if (!target) return "";
  return ` data-st-id="${target.id}"`;
}

function attrsFrom(element: ts.JsxOpeningLikeElement, ctx: Ctx, from?: FileModule): string {
  const parts: string[] = [];
  for (const attr of element.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    const name = attr.name.text;
    if (SKIP_ATTR.test(name)) continue;
    if (name === "className") {
      const value = attr.initializer
        ? ts.isStringLiteral(attr.initializer)
          ? attr.initializer.text
          : ts.isJsxExpression(attr.initializer) && attr.initializer.expression
            ? classFromExpr(attr.initializer.expression, ctx)
            : ""
        : "";
      if (value) parts.push(`class="${escapeAttr(value)}"`);
      continue;
    }
    if (name === "htmlFor") {
      const value = attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : "";
      if (value) parts.push(`for="${escapeAttr(value)}"`);
      continue;
    }
    if (name === "style" && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const value = styleFromExpr(attr.initializer.expression, ctx, from);
      if (value) parts.push(`style="${escapeAttr(value)}"`);
      continue;
    }
    if (!attr.initializer) {
      parts.push(name);
      continue;
    }
    if (ts.isStringLiteral(attr.initializer)) {
      parts.push(`${name === "className" ? "class" : name}="${escapeAttr(attr.initializer.text)}"`);
      continue;
    }
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const lit = literalValue(attr.initializer.expression);
      if (name === "disabled" || name === "checked" || name === "required" || name === "readOnly") {
        if (lit === true) parts.push(name);
        continue;
      }
      if (name === "aria-invalid" || name === "aria-current") {
        if (typeof lit === "string" || lit === true) {
          parts.push(`${name}="${escapeAttr(String(lit))}"`);
        }
        continue;
      }
      if (name === "value") {
        if (typeof lit === "string" || typeof lit === "number") {
          parts.push(`value="${escapeAttr(String(lit))}"`);
        }
        continue;
      }
      const text = typeof lit === "string" || typeof lit === "number" ? String(lit) : textFromExpr(attr.initializer.expression, ctx, from);
      if (text && text !== "Undefined") parts.push(`${name}="${escapeAttr(text)}"`);
    }
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

async function resolveComponent(
  name: string,
  from: FileModule,
  ctx: Ctx,
): Promise<{ fn: ts.FunctionLikeDeclaration; mod: FileModule } | null> {
  const local = from.exports.get(name);
  if (local && (ts.isFunctionDeclaration(local) || ts.isArrowFunction(local) || ts.isFunctionExpression(local))) {
    return { fn: local, mod: from };
  }
  const imported = from.imports.get(name);
  if (!imported) return null;
  if (imported.spec === "next/link" || imported.spec === "next/image") return null;
  const file = await resolveImportFile(imported.spec, from.file, ctx.aliases);
  if (!file) return null;
  const mod = await loadModule(file, ctx);
  if (!mod) return null;
  const exp = mod.exports.get(imported.name === "default" ? "default" : imported.name) ?? mod.exports.get("default");
  if (exp && (ts.isFunctionDeclaration(exp) || ts.isArrowFunction(exp) || ts.isFunctionExpression(exp))) {
    return { fn: exp, mod };
  }
  return null;
}

async function evalImportedValue(
  name: string,
  from: FileModule,
  ctx: Ctx,
): Promise<unknown> {
  if (from.values.has(name)) return from.values.get(name);
  const imported = from.imports.get(name);
  if (!imported) return undefined;
  const file = await resolveImportFile(imported.spec, from.file, ctx.aliases);
  if (!file) return undefined;
  const mod = await loadModule(file, ctx);
  if (!mod) return undefined;
  return mod.values.get(imported.name === "default" ? [...mod.values.keys()][0] ?? "" : imported.name);
}

function applyParamDefaults(
  fn: ts.FunctionLikeDeclaration,
  props: Map<string, unknown>,
): void {
  for (const param of fn.parameters) {
    if (!ts.isObjectBindingPattern(param.name)) continue;
    for (const el of param.name.elements) {
      if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name) || !el.initializer) continue;
      if (props.has(el.name.text)) continue;
      const lit = literalValue(el.initializer);
      if (lit !== undefined) props.set(el.name.text, lit);
    }
  }
}

function bindProps(
  element: ts.JsxOpeningLikeElement,
  ctx: Ctx,
  from: FileModule,
): Map<string, unknown> {
  const props = new Map<string, unknown>();
  for (const attr of element.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    if (!attr.initializer) {
      props.set(attr.name.text, true);
      continue;
    }
    if (ts.isStringLiteral(attr.initializer)) {
      props.set(attr.name.text, attr.initializer.text);
      continue;
    }
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const expr = attr.initializer.expression;
      const lit = literalValue(expr);
      if (lit !== undefined) {
        props.set(attr.name.text, lit);
        continue;
      }
      if (ts.isIdentifier(expr)) {
        if (ctx.props.has(expr.text)) {
          props.set(attr.name.text, ctx.props.get(expr.text));
          continue;
        }
        if (from.values.has(expr.text)) {
          props.set(attr.name.text, from.values.get(expr.text));
          continue;
        }
      }
      props.set(attr.name.text, expr.getText());
    }
  }
  return props;
}

function islandPropsOf(props: Map<string, unknown>): {
  props: Record<string, unknown>;
  callbacks: string[];
} {
  const json: Record<string, unknown> = {};
  const callbacks: string[] = [];
  for (const [key, value] of props) {
    if (/^on[A-Z]/.test(key)) {
      callbacks.push(key);
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      json[key] = value;
    }
  }
  return { props: json, callbacks };
}

async function renderMap(expr: ts.CallExpression, from: FileModule, ctx: Ctx): Promise<string> {
  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "map") return "";
  const cb = expr.arguments[0];
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return "";
  const itemName =
    cb.parameters[0] && ts.isIdentifier(cb.parameters[0].name) ? cb.parameters[0].name.text : "item";
  const sourceName = callee.expression.getText();
  let rows: Sample[] = SAMPLES;
  const imported = await evalImportedValue(sourceName, from, ctx);
  if (Array.isArray(imported) && imported.length > 0) {
    rows = imported.map((row) => {
      if (row && typeof row === "object") {
        const next: Sample = {};
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
          if (typeof value === "string" || typeof value === "number") next[key] = String(value);
        }
        return next;
      }
      return { value: String(row) };
    });
  } else if (Array.isArray(from.values.get(sourceName))) {
    rows = (from.values.get(sourceName) as unknown[]).map((row) =>
      row && typeof row === "object"
        ? Object.fromEntries(
            Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        : { value: String(row) },
    );
  }
  const body = cb.body;
  const chunks: string[] = [];
  for (let index = 0; index < Math.min(rows.length, 4); index++) {
    const next: Ctx = {
      ...ctx,
      map: { item: itemName, values: rows[index]!, index },
    };
    if (isJsx(body)) {
      chunks.push(await renderNode(body, from, next));
    } else if (ts.isBlock(body)) {
      const ret = findJsxReturn(cb);
      if (ret) chunks.push(await renderNode(ret, from, next));
    } else if (ts.isParenthesizedExpression(body) && isJsx(body.expression)) {
      chunks.push(await renderNode(body.expression, from, next));
    } else {
      chunks.push(await renderNode(body, from, next));
    }
  }
  return chunks.join("");
}

async function renderExpr(expr: ts.Expression, from: FileModule, ctx: Ctx): Promise<string> {
  if (isJsx(expr)) return renderNode(expr, from, ctx);
  if (ts.isParenthesizedExpression(expr)) return renderExpr(expr.expression, from, ctx);
  if (ts.isConditionalExpression(expr)) {
    return renderExpr(pickTernary(expr.condition, expr.whenTrue, expr.whenFalse), from, ctx);
  }
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    if (!condIsOn(expr.left as ts.Expression, ctx, from)) return "";
    const rightText = expr.right.getText();
    if (/fixed[\s\S]*inset-0/.test(rightText) && /bg-black|bg-\[#|backdrop|z-40|z-50/i.test(rightText)) {
      return "";
    }
    return renderExpr(expr.right, from, ctx);
  }
  if (ts.isIdentifier(expr) && ctx.slots.has(expr.text)) {
    return ctx.slots.get(expr.text) ?? "";
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "map") {
    return renderMap(expr, from, ctx);
  }
  const text = textFromExpr(expr, ctx, from);
  return text ? escapeHtml(text) : "";
}

async function renderNode(node: ts.Node, from: FileModule, ctx: Ctx): Promise<string> {
  if (ts.isParenthesizedExpression(node)) return renderNode(node.expression, from, ctx);
  if (ts.isJsxFragment(node)) {
    const parts = await Promise.all(node.children.map((child) => renderNode(child, from, ctx)));
    return parts.join("");
  }
    if (ts.isJsxText(node)) {
    if (node.containsOnlyTriviaWhiteSpaces) return "";
    const decoded = node.text
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replace(/\s+/g, " ");
    return escapeHtml(decoded);
  }
  if (ts.isJsxExpression(node)) {
    if (!node.expression) return "";
    return renderExpr(node.expression, from, ctx);
  }
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) {
    const open = ts.isJsxElement(node) ? node.openingElement : node;
    const name = tagName(open.tagName);
    if (name === "Link") {
      const inner = ts.isJsxElement(node)
        ? (await Promise.all(node.children.map((child) => renderNode(child, from, ctx)))).join("")
        : "";
      return `<a${attrsFrom(open, ctx, from)}${stampInspect(open, "a", inner, from, ctx)}>${inner}</a>`;
    }
    if (name === "Image") {
      return `<img${attrsFrom(open, ctx, from)}${stampInspect(open, "img", "", from, ctx)} />`;
    }
    if (name === "Fragment") {
      const inner = ts.isJsxElement(node)
        ? (await Promise.all(node.children.map((child) => renderNode(child, from, ctx)))).join("")
        : "";
      return inner;
    }
    if (!INTRINSIC.has(name) && name[0] === name[0]?.toUpperCase()) {
      if (ctx.depth > 8) return "";
      const inner = ts.isJsxElement(node)
        ? (await Promise.all(node.children.map((child) => renderNode(child, from, ctx)))).join("")
        : "";
      const resolved = await resolveComponent(name, from, ctx);
      if (resolved) {
        const slots = new Map(ctx.slots);
        if (inner) slots.set("children", inner);
        const props = bindProps(open, ctx, from);
        applyParamDefaults(resolved.fn, props);
        const childCtx: Ctx = {
          ...ctx,
          depth: ctx.depth + 1,
          props,
          component: name,
          slots,
        };
        const jsx = findJsxReturn(resolved.fn);
        const fallback = jsx ? await renderNode(jsx, resolved.mod, childCtx) : inner;
        if (sourceNeedsLiveRuntime(resolved.mod.text)) {
          const imported = from.imports.get(name);
          const exportName =
            imported?.name === "default"
              ? "default"
              : (imported?.name ??
                (resolved.mod.exports.has(name) ? name : "default"));
          const packed = islandPropsOf(props);
          const islandId = `st-live-${ctx.islands.length + 1}`;
          ctx.islands.push({
            id: islandId,
            file: resolved.mod.file,
            exportName,
            props: packed.props,
            callbacks: packed.callbacks,
          });
          const inspectId = fallback.match(/data-st-id="([^"]+)"/)?.[1];
          const inspectAttr = inspectId ? ` data-st-id="${inspectId}"` : "";
          return `<div id="${islandId}" class="st-live-island" style="position:relative;width:100%;height:100%;min-height:100vh"${inspectAttr}>${fallback}</div>`;
        }
        return fallback;
      }
      return inner;
    }
    const tag = INTRINSIC.has(name) ? name : "div";
    const attrs = attrsFrom(open, ctx, from);
    const inner = ts.isJsxElement(node)
      ? (await Promise.all(node.children.map((child) => renderNode(child, from, ctx)))).join("")
      : "";
    return htmlElement(tag, attrs, stampInspect(open, tag, inner, from, ctx), inner);
  }
  if (ts.isExpression(node)) return renderExpr(node, from, ctx);
  return "";
}

async function bodyClassFromLayout(appRoot: string): Promise<string> {
  for (const rel of ["src/app/layout.tsx", "app/layout.tsx", "src/app/layout.jsx", "app/layout.jsx"]) {
    try {
      const text = await readFile(path.join(appRoot, rel), "utf8");
      const match = text.match(/<body\b[^>]*className=\{?["'`]([^"'`]+)["'`]/);
      if (match?.[1]) return match[1];
      const body = text.match(/<body\b([^>]*)>/);
      const cls = body?.[1]?.match(/className=["'`]([^"'`]+)["'`]/);
      if (cls?.[1]) return cls[1];
    } catch {
      /* next */
    }
  }
  return "min-h-full";
}

export async function renderSourceMarkup(input: {
  appRoot: string;
  file: string;
  route?: string;
  pageName?: string;
  inspect?: boolean;
}): Promise<{ html: string; bodyClass: string; targets: InspectTarget[]; islands: LiveIsland[] }> {
  const abs = path.isAbsolute(input.file) ? input.file : path.join(input.appRoot, input.file);
  const aliases = await readTsconfigAliases(input.appRoot);
  const inspect: InspectWalk | null = input.inspect
    ? { route: input.route || "/", pageName: input.pageName || "Page", targets: [], seq: 0 }
    : null;
  const ctx: Ctx = {
    appRoot: input.appRoot,
    modules: new Map(),
    aliases,
    depth: 0,
    map: null,
    props: new Map(),
    component: input.pageName || "Page",
    inspect,
    slots: new Map(),
    islands: [],
  };
  const file = await tryRead(abs);
  if (!file) throw new Error(`Could not read ${input.file}.`);
  const mod = await loadModule(file, ctx);
  if (!mod) throw new Error(`Could not parse ${input.file}.`);
  const page = mod.exports.get("default");
  if (!page || !(ts.isFunctionDeclaration(page) || ts.isArrowFunction(page) || ts.isFunctionExpression(page))) {
    throw new Error(`No page component in ${input.file}.`);
  }
  if (ts.isFunctionDeclaration(page) && page.name?.text) {
    ctx.component = page.name.text;
  }
  const jsx = findJsxReturn(page);
  if (!jsx) throw new Error(`That page has no markup to show (${input.file}).`);
  const html = await renderNode(jsx, mod, ctx);
  const bodyClass = await bodyClassFromLayout(input.appRoot);
  return {
    html: html || "<main></main>",
    bodyClass,
    targets: inspect?.targets ?? [],
    islands: ctx.islands,
  };
}

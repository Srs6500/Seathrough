import { readFileSync } from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

export const SCENE_CODE_MAX = 24_000;

/** Global the film runtime resets to 0 before every scene call. */
export const LOOP_COUNTER = "__loops";
const LOOP_GUARD = `if(++${LOOP_COUNTER}>3e6)throw new Error("A loop in this scene ran too long.");`;

const BANNED_IDENTIFIERS = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "eval",
  "Worker",
  "SharedWorker",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "defineFilm",
]);

const BANNED_PROPERTIES = new Set(["cookie", "postMessage", "sendBeacon", "opener"]);

type Parsed = acorn.Program;

function parse(code: string): Parsed {
  return acorn.parse(code, { ecmaVersion: 2022, sourceType: "script", locations: true });
}

function syntaxMessage(error: unknown): string {
  if (error instanceof SyntaxError) return `Syntax error: ${error.message}`;
  return error instanceof Error ? error.message : "The scene code could not be read.";
}

function declaresScene(program: Parsed, name: string): boolean {
  return program.body.some((node) => {
    if (node.type === "FunctionDeclaration") return node.id?.name === name;
    if (node.type === "VariableDeclaration") {
      return node.declarations.some(
        (decl) => decl.id.type === "Identifier" && decl.id.name === name,
      );
    }
    return false;
  });
}

function bannedUse(program: Parsed): string | null {
  let found: string | null = null;
  walk.full(program, (node) => {
    if (found) return;
    if (node.type === "ImportExpression") {
      found = "import()";
      return;
    }
    if (node.type === "Identifier" && BANNED_IDENTIFIERS.has((node as acorn.Identifier).name)) {
      found = (node as acorn.Identifier).name;
      return;
    }
    if (node.type === "NewExpression" || node.type === "CallExpression") {
      const callee = (node as acorn.NewExpression | acorn.CallExpression).callee;
      if (callee.type === "Identifier" && callee.name === "Function") found = "Function()";
      return;
    }
    if (node.type === "MemberExpression") {
      const member = node as acorn.MemberExpression;
      const prop =
        member.property.type === "Identifier" && !member.computed
          ? member.property.name
          : member.property.type === "Literal" && typeof member.property.value === "string"
            ? member.property.value
            : null;
      if (prop && BANNED_PROPERTIES.has(prop)) {
        found = `.${prop}`;
        return;
      }
      if (
        member.object.type === "Identifier" &&
        ["window", "globalThis", "self"].includes(member.object.name) &&
        prop &&
        ["parent", "top", "frames", "open", "location"].includes(prop)
      ) {
        found = `${member.object.name}.${prop}`;
      }
    }
  });
  return found;
}

/** `const rng = rng(3)` throws at runtime (temporal dead zone); catch it before the browser does. */
function selfShadow(program: Parsed): string | null {
  let found: string | null = null;
  walk.simple(program, {
    VariableDeclarator(node) {
      if (found || node.id.type !== "Identifier" || !node.init) return;
      const name = node.id.name;
      walk.ancestor(node.init, {
        Identifier(inner, _state, ancestors) {
          if (found || inner.name !== name) return;
          const rebound = ancestors.some(
            (ancestor) =>
              (ancestor.type === "ArrowFunctionExpression" ||
                ancestor.type === "FunctionExpression") &&
              (ancestor as acorn.Function).params.some(
                (param) => param.type === "Identifier" && param.name === name,
              ),
          );
          if (!rebound) found = name;
        },
      });
    },
  });
  return found;
}

const LANGUAGE_GLOBALS = [
  "Math", "Number", "String", "Boolean", "Array", "Object", "JSON", "Symbol", "BigInt", "Map", "Set",
  "WeakMap", "WeakSet", "Promise", "Reflect", "Proxy", "Error", "TypeError", "RangeError", "Infinity",
  "NaN", "undefined", "isFinite", "isNaN", "parseFloat", "parseInt", "Date", "arguments", "console",
  "Float32Array", "Float64Array", "Int8Array", "Int16Array", "Int32Array", "Uint8Array", "Uint16Array",
  "Uint32Array", "Uint8ClampedArray", "ArrayBuffer", "DataView",
  "window", "globalThis", "self", "document", "performance", "Path2D", "ImageData", "DOMMatrix",
  "OffscreenCanvas", "CanvasGradient", "CanvasPattern", "HTMLCanvasElement", "CanvasRenderingContext2D",
];

let runtimeGlobals: Set<string> | null = null;

/** Every top-level name core.js and kit.js define, read from the files the browser loads. */
function knownGlobals(): Set<string> {
  if (runtimeGlobals) return runtimeGlobals;
  const names = new Set(LANGUAGE_GLOBALS);
  const root = /* turbopackIgnore: true */ process.cwd();
  for (const file of ["core.js", "kit.js"]) {
    const filePath = path.join(root, "public", "film-engine", file);
    const source = readFileSync(/* turbopackIgnore: true */ filePath, "utf8");
    const program = acorn.parse(source, { ecmaVersion: 2022, sourceType: "script" });
    for (const node of program.body) {
      if (node.type === "FunctionDeclaration" && node.id) names.add(node.id.name);
      if (node.type === "VariableDeclaration") {
        for (const decl of node.declarations) if (decl.id.type === "Identifier") names.add(decl.id.name);
      }
    }
    for (const match of source.matchAll(/window\.(__[A-Za-z]+)\s*=/g)) names.add(match[1]!);
  }
  runtimeGlobals = names;
  return names;
}

function patternNames(pattern: acorn.Pattern | null | undefined, out: string[] = []): string[] {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        patternNames(prop.type === "RestElement" ? prop.argument : prop.value, out);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) patternNames(element, out);
      break;
    case "RestElement":
      patternNames(pattern.argument, out);
      break;
    case "AssignmentPattern":
      patternNames(pattern.left, out);
      break;
  }
  return out;
}

const FUNCTION_SCOPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const BLOCK_SCOPES = new Set([
  "Program", "BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement",
  "StaticBlock",
]);

/** Names the scene reads that no enclosing scope declares: they would throw ReferenceError. */
function undefinedNames(program: Parsed): string[] {
  const scopes = new Map<acorn.Node, Set<string>>();
  const declare = (scope: acorn.Node | undefined, names: string[]) => {
    if (!scope) return;
    const set = scopes.get(scope) ?? new Set<string>();
    for (const name of names) set.add(name);
    scopes.set(scope, set);
  };
  const nearest = (ancestors: acorn.Node[], kinds: Set<string>, skipSelf: boolean) => {
    for (let i = ancestors.length - (skipSelf ? 2 : 1); i >= 0; i--) {
      if (kinds.has(ancestors[i]!.type)) return ancestors[i];
    }
    return undefined;
  };
  const functionOrProgram = new Set([...FUNCTION_SCOPES, "Program"]);

  walk.ancestor(program, {
    VariableDeclaration(node, _state, ancestors) {
      const names = node.declarations.flatMap((decl) => patternNames(decl.id));
      declare(nearest(ancestors, node.kind === "var" ? functionOrProgram : BLOCK_SCOPES, true), names);
    },
    FunctionDeclaration(node, _state, ancestors) {
      if (node.id) declare(nearest(ancestors, functionOrProgram, true), [node.id.name]);
      declare(node, node.params.flatMap((param) => patternNames(param)));
    },
    FunctionExpression(node) {
      declare(node, [
        ...(node.id ? [node.id.name] : []),
        ...node.params.flatMap((param) => patternNames(param)),
      ]);
    },
    ArrowFunctionExpression(node) {
      declare(node, node.params.flatMap((param) => patternNames(param)));
    },
    ClassDeclaration(node, _state, ancestors) {
      if (node.id) declare(nearest(ancestors, BLOCK_SCOPES, true), [node.id.name]);
    },
    CatchClause(node) {
      declare(node, patternNames(node.param));
    },
  });

  const known = knownGlobals();
  const missing = new Set<string>();
  walk.ancestor(program, {
    Identifier(node, _state, ancestors) {
      if (known.has(node.name) || missing.has(node.name)) return;
      const resolved = ancestors.some((ancestor) => scopes.get(ancestor)?.has(node.name));
      if (!resolved) missing.add(node.name);
    },
  });
  return [...missing];
}

type Insert = { at: number; text: string };

function guardLoops(code: string, program: Parsed): string {
  const inserts: Insert[] = [];
  const onLoop = (node: acorn.Node) => {
    const body = (node as unknown as { body: acorn.Node }).body;
    if (body.type === "BlockStatement") {
      inserts.push({ at: body.start + 1, text: LOOP_GUARD });
    } else {
      inserts.push({ at: body.start, text: `{${LOOP_GUARD}` });
      inserts.push({ at: body.end, text: "}" });
    }
  };
  walk.simple(program, {
    ForStatement: onLoop,
    ForInStatement: onLoop,
    ForOfStatement: onLoop,
    WhileStatement: onLoop,
    DoWhileStatement: onLoop,
  });
  inserts.sort((a, b) => b.at - a.at);
  let out = code;
  for (const insert of inserts) {
    out = out.slice(0, insert.at) + insert.text + out.slice(insert.at);
  }
  return out;
}

export type PreparedScene = { ok: true; code: string } | { ok: false; error: string };

/**
 * Validate one scene's source and return a guarded copy the browser runtime can load.
 * `number` is 1-based: scene 1 must declare `scene1`.
 */
export function prepareScene(source: string, number: number): PreparedScene {
  const code = source.trim();
  const name = `scene${number}`;
  if (!code) return { ok: false, error: `Scene ${number} came back empty.` };
  if (code.length > SCENE_CODE_MAX) {
    return { ok: false, error: `Scene ${number} is too long. Keep it under ${SCENE_CODE_MAX} characters.` };
  }
  let program: Parsed;
  try {
    program = parse(code);
  } catch (error) {
    return { ok: false, error: syntaxMessage(error) };
  }
  if (!declaresScene(program, name)) {
    return { ok: false, error: `Define the scene as function ${name}(c, tau, i) { ... }.` };
  }
  const banned = bannedUse(program);
  if (banned) {
    return { ok: false, error: `Scenes may not use ${banned}. Draw with the canvas and core.js only.` };
  }
  const missing = undefinedNames(program);
  if (missing.length) {
    const list = missing.slice(0, 6).join(", ");
    return {
      ok: false,
      error: `${list} ${missing.length === 1 ? "is" : "are"} not defined. Declare ${missing.length === 1 ? "it" : "them"} inside the scene function or use PAL colours and the library.`,
    };
  }
  const shadowed = selfShadow(program);
  if (shadowed) {
    return {
      ok: false,
      error: `"const ${shadowed} = ...${shadowed}..." uses the name it is declaring. Rename the variable (for example r instead of rng).`,
    };
  }
  const guarded = guardLoops(code, program);
  try {
    parse(guarded);
  } catch (error) {
    return { ok: false, error: syntaxMessage(error) };
  }
  return { ok: true, code: guarded };
}

const SCENE_START = /(?:^|\n)[ \t]*(?:async\s+)?(?:function\s+scene(\d+)\s*\(|(?:const|let|var)\s+scene(\d+)\s*=)/g;

/** Where a declaration that starts at `start` ends, matched by brace depth on real tokens. */
function declarationEnd(text: string, start: number): number | null {
  let depth = 0;
  let opened = false;
  try {
    const tokens = acorn.tokenizer(text.slice(start), { ecmaVersion: 2022 });
    for (const token of tokens) {
      const label = token.type.label;
      if (label === "{" || label === "${") {
        depth += 1;
        opened = true;
      } else if (label === "}") {
        depth -= 1;
        if (opened && depth === 0) {
          const rest = text.slice(start + token.end);
          const semi = rest.match(/^[ \t]*;/);
          return start + token.end + (semi ? semi[0].length : 0);
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Split a model reply into per-scene sources, index 0 = scene 1.
 * A scene the reply never defines comes back as null.
 */
export function extractScenes(raw: string, count: number): (string | null)[] {
  const text = raw.replace(/```[a-z]*\n?/gi, "\n");
  const found: { number: number; start: number }[] = [];
  for (const match of text.matchAll(SCENE_START)) {
    const number = Number(match[1] ?? match[2]);
    const offset = match[0].startsWith("\n") ? 1 : 0;
    found.push({ number, start: (match.index ?? 0) + offset });
  }
  const zeroBased = found.some((entry) => entry.number === 0);
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  found.forEach((entry, index) => {
    const number = zeroBased ? entry.number + 1 : entry.number;
    if (number < 1 || number > count || out[number - 1]) return;
    const next = found[index + 1]?.start ?? text.length;
    const end = declarationEnd(text, entry.start) ?? next;
    let body = text.slice(entry.start, Math.min(end, next)).trim();
    if (zeroBased) body = body.replace(new RegExp(`\\bscene${entry.number}\\b`), `scene${number}`);
    out[number - 1] = body;
  });
  return out;
}

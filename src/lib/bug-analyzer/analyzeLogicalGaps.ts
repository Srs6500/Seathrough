import OpenAI from "openai";
import { z } from "zod";
import type { RepoAnalysis } from "@/lib/bug-analyzer/analyzeRepo";
import type {
  DataIndex,
  FeatureFlow,
  KnowledgeRecord,
  PageSummary,
} from "@/lib/bug-analyzer/buildDataIndex";
import { getLlmConfig } from "@/lib/env";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";

export type NodeHealth = "ok" | "critical" | "warning" | "unused" | "missing";
export type FindingStatus = "confirmed" | "likely" | "unknown";
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type ArchLayer =
  | "frontend"
  | "api"
  | "service"
  | "external";

export const archNodeSchema = z.object({
  id: z.string().min(1),
  layer: z.enum(["frontend", "api", "service", "external"]),
  label: z.string().min(1),
  subtitle: z.string().optional(),
  route: z.string().optional(),
  file: z.string().optional(),
  health: z.enum(["ok", "critical", "warning", "unused", "missing"]),
  note: z.string().optional(),
});

export const archEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(["flow", "broken", "missing"]),
});

export const findingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: z.enum(["confirmed", "likely", "unknown"]),
  category: z.string().min(1),
  summary: z.string().min(1),
  inferredIntent: z.string().min(1),
  contradiction: z.string().min(1),
  flow: z.array(z.string()).max(8),
  nodeIds: z.array(z.string()).max(12),
  evidence: z
    .array(
      z.object({
        file: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        snippet: z.string(),
        note: z.string().optional(),
      }),
    )
    .max(6),
  fixSuggestion: z.string().min(1),
  relatedFindingIds: z.array(z.string()).max(8).optional(),
});

export type ArchNode = z.infer<typeof archNodeSchema>;
export type ArchEdge = z.infer<typeof archEdgeSchema>;
export type LogicalFinding = z.infer<typeof findingSchema>;

export type ArchitectureReport = {
  nodes: ArchNode[];
  edges: ArchEdge[];
  findings: LogicalFinding[];
  source: "ai" | "heuristic";
  analyzedAt: string;
};

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function stem(path: string): string {
  return basename(path).replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

function pageTitle(route: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback;
  if (!route || route === "/") return "Home Page";
  const seg = route.split("/").filter(Boolean).pop() || route;
  const label = seg
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} Page`;
}

function lineOf(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function excerpt(
  content: string,
  startLine: number,
  endLine: number,
): string {
  const lines = content.split("\n");
  return lines
    .slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine))
    .join("\n")
    .slice(0, 500);
}

function hasDbUsage(content: string): boolean {
  return /prisma\.|drizzle|mongoose\.|supabase|createClient\(|\.from\(|sql`|knex\(|typeorm|sequelize|mongodb|dynamodb|\.insert\(|\.create\(|\.upsert\(|\.update\(/i.test(
    content,
  );
}

function hasAuthVerify(content: string): boolean {
  return /bcrypt|argon2|scrypt|compare\(|verifyPassword|checkPassword|authenticate|getUser\(|getSession\(|auth\.|clerk|next-auth|supabase\.auth|jwt\.verify|passwordHash|hashedPassword/i.test(
    content,
  );
}

function alwaysSucceeds(content: string): boolean {
  const success =
    /success\s*:\s*true|\{[^}]*ok\s*:\s*true|NextResponse\.json\(\s*\{\s*success\s*:\s*true/i.test(
      content,
    );
  const noGate =
    !hasAuthVerify(content) &&
    !/if\s*\([^)]*(password|user|credential)/i.test(content) &&
    !/throw new|return NextResponse\.json\([^,]+,\s*\{\s*status:\s*4/i.test(
      content,
    );
  return success && noGate;
}

function hasAuthGuard(content: string): boolean {
  return /getServerSession|auth\(\)|currentUser|requireAuth|protect|middleware|unauthorized|401|getSession|clerk|supabase\.auth/i.test(
    content,
  );
}

function detectDeps(files: RepoSourceFile[]): {
  hasDbPackage: boolean;
  hasAuthPackage: boolean;
  hasStoragePackage: boolean;
  packages: string[];
} {
  const pkgFile = files.find(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );
  const packages: string[] = [];
  let hasDbPackage = false;
  let hasAuthPackage = false;
  let hasStoragePackage = false;
  if (pkgFile) {
    try {
      const json = JSON.parse(pkgFile.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...json.dependencies, ...json.devDependencies };
      packages.push(...Object.keys(deps));
      hasDbPackage = Object.keys(deps).some((k) =>
        /prisma|drizzle|mongoose|pg|mysql|sqlite|supabase|firebase|typeorm|sequelize|mongodb/i.test(
          k,
        ),
      );
      hasAuthPackage = Object.keys(deps).some((k) =>
        /next-auth|auth\.js|clerk|supabase|firebase-auth|lucia|better-auth|passport/i.test(
          k,
        ),
      );
      hasStoragePackage = Object.keys(deps).some((k) =>
        /s3|uploadthing|cloudinary|firebase-storage|@aws-sdk\/client-s3/i.test(
          k,
        ),
      );
    } catch {
      /* ignore */
    }
  }
  const all = files.map((f) => f.content).join("\n");
  if (!hasDbPackage && hasDbUsage(all)) hasDbPackage = true;
  if (!hasAuthPackage && hasAuthVerify(all)) hasAuthPackage = true;
  return { hasDbPackage, hasAuthPackage, hasStoragePackage, packages };
}

function collectFetchTargets(content: string): string[] {
  const out: string[] = [];
  const re =
    /(?:fetch|axios\.(?:get|post|put|patch|delete)|\$\.ajax)\(\s*[`'"]([^`'"]+)[`'"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    out.push(m[1]!);
  }
  const routeRe = /['"`](\/api\/[^'"`]+)['"`]/g;
  while ((m = routeRe.exec(content))) {
    out.push(m[1]!);
  }
  return [...new Set(out)];
}

function normalizeApiPath(path: string): string {
  try {
    if (path.startsWith("http")) {
      const u = new URL(path);
      return u.pathname;
    }
  } catch {
    /* ignore */
  }
  return path.split("?")[0] || path;
}

/** Level 1 — structural architecture + gap heuristics (no LLM). */
export function buildArchitectureReport(input: {
  analysis: RepoAnalysis;
  files: RepoSourceFile[];
  records: KnowledgeRecord[];
  pages: PageSummary[];
  features: FeatureFlow[];
}): ArchitectureReport {
  const contentByPath = new Map(input.files.map((f) => [f.path, f.content]));
  const deps = detectDeps(input.files);
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const findings: LogicalFinding[] = [];
  const nodeById = new Map<string, ArchNode>();

  const pushNode = (n: ArchNode) => {
    if (nodeById.has(n.id)) return;
    nodeById.set(n.id, n);
    nodes.push(n);
  };

  // --- Frontend pages ---
  for (const page of input.analysis.pages.slice(0, 16)) {
    const id = `fe:${page.route || page.path}`;
    pushNode({
      id,
      layer: "frontend",
      label: pageTitle(page.route, page.title),
      subtitle: page.route || "/",
      route: page.route || "/",
      file: page.path,
      health: "ok",
    });
  }

  // --- API routes ---
  for (const route of input.analysis.apiRoutes.slice(0, 20)) {
    const content = contentByPath.get(route.path) || "";
    const methods = route.methods.length ? route.methods : ["GET"];
    for (const method of methods.slice(0, 3)) {
      const id = `api:${method}:${route.route}`;
      let health: NodeHealth = "ok";
      let note = "Looks reachable";
      if (/auth|login|signup|sign-up|register/i.test(route.route)) {
        if (alwaysSucceeds(content)) {
          health = "critical";
          note = /login/i.test(route.route)
            ? "Accepts any credentials"
            : "Does not persist user";
        } else if (!hasAuthVerify(content) && !hasDbUsage(content)) {
          health = "warning";
          note = "Weak verification signals";
        }
      } else if (/user|profile|me|dashboard/i.test(route.route)) {
        if (!hasAuthGuard(content)) {
          health = "warning";
          note = "No authentication check";
        }
      } else if (hasDbUsage(content) || /json|posts|data/i.test(content)) {
        note = "Fetches data";
      }
      pushNode({
        id,
        layer: "api",
        label: `${method} ${route.route}`,
        subtitle: basename(route.path),
        route: route.route,
        file: route.path,
        health,
        note,
      });
    }
  }

  // --- Services / logic ---
  const serviceFiles = input.files.filter(
    (f) =>
      /(^|\/)(services?|lib|utils?)\/.+\.(ts|tsx|js|jsx)$/i.test(f.path) &&
      !/\.d\.ts$/i.test(f.path) &&
      !/\/(ui|icons|types)\//i.test(f.path),
  );
  const preferred = serviceFiles.filter((f) =>
    /auth|user|post|order|bill|payment|session/i.test(f.path),
  );
  const servicePick = (
    preferred.length ? preferred : serviceFiles
  ).slice(0, 10);
  for (const file of servicePick) {
    const content = file.content;
    const id = `svc:${file.path}`;
    let health: NodeHealth = "ok";
    let note = "Working as expected";
    if (/auth/i.test(file.path) && alwaysSucceeds(content)) {
      health = "critical";
      note = "Returns success without verification";
    } else if (
      /user|auth|profile/i.test(file.path) &&
      !hasDbUsage(content) &&
      !hasAuthVerify(content)
    ) {
      health = "critical";
      note = "No database integration found";
    } else if (!hasDbUsage(content) && /save|create|persist|update/i.test(content)) {
      health = "warning";
      note = "Persistence unclear";
    }
    pushNode({
      id,
      layer: "service",
      label: basename(file.path),
      subtitle: file.path,
      file: file.path,
      health,
      note,
    });
  }

  // --- External ---
  pushNode({
    id: "ext:database",
    layer: "external",
    label: "Database",
    health: deps.hasDbPackage ? "ok" : "missing",
    note: deps.hasDbPackage ? "Configured / referenced" : "Not found",
  });
  pushNode({
    id: "ext:auth-provider",
    layer: "external",
    label: "Authentication Provider",
    health: deps.hasAuthPackage ? "ok" : "missing",
    note: deps.hasAuthPackage ? "Configured / referenced" : "Not configured",
  });
  pushNode({
    id: "ext:storage",
    layer: "external",
    label: "File Storage",
    health: deps.hasStoragePackage ? "ok" : "missing",
    note: deps.hasStoragePackage ? "Configured" : "Not configured",
  });
  const usesExternalApi = input.files.some((f) =>
    /https?:\/\/(?!localhost)/i.test(f.content),
  );
  pushNode({
    id: "ext:api",
    layer: "external",
    label: "External API",
    health: usesExternalApi ? "ok" : "unused",
    note: usesExternalApi ? "Referenced" : "Not used",
  });

  // --- Edges: page → api → service → external ---
  let edgeN = 0;
  for (const page of input.analysis.pages) {
    const feId = `fe:${page.route || page.path}`;
    const content = contentByPath.get(page.path) || "";
    const targets = collectFetchTargets(content);
    // Also scan sibling components imported by path stem
    for (const file of input.files) {
      if (
        file.path.includes("components") &&
        (content.includes(stem(file.path)) ||
          page.route
            .split("/")
            .filter(Boolean)
            .some((seg) => file.path.toLowerCase().includes(seg.toLowerCase())))
      ) {
        targets.push(...collectFetchTargets(file.content));
      }
    }
    for (const t of [...new Set(targets)].slice(0, 6)) {
      const path = normalizeApiPath(t);
      const apiNode = nodes.find(
        (n) =>
          n.layer === "api" &&
          n.route &&
          (path === n.route || path.endsWith(n.route) || n.route.endsWith(path)),
      );
      if (apiNode && nodeById.has(feId)) {
        edges.push({
          id: `e${edgeN++}`,
          from: feId,
          to: apiNode.id,
          kind: apiNode.health === "critical" ? "broken" : "flow",
        });
      }
    }
    // Heuristic: login page → login api
    if (/login|signin|sign-in/i.test(page.route + page.path)) {
      const api = nodes.find(
        (n) => n.layer === "api" && /login|signin|auth/i.test(n.route || ""),
      );
      if (api && nodeById.has(feId)) {
        edges.push({
          id: `e${edgeN++}`,
          from: feId,
          to: api.id,
          kind: api.health === "critical" ? "broken" : "flow",
        });
      }
    }
    if (/signup|sign-up|register/i.test(page.route + page.path)) {
      const api = nodes.find(
        (n) =>
          n.layer === "api" && /signup|sign-up|register/i.test(n.route || ""),
      );
      if (api && nodeById.has(feId)) {
        edges.push({
          id: `e${edgeN++}`,
          from: feId,
          to: api.id,
          kind: api.health === "critical" ? "broken" : "flow",
        });
      }
    }
  }

  for (const api of nodes.filter((n) => n.layer === "api")) {
    const content = contentByPath.get(api.file || "") || "";
    for (const svc of nodes.filter((n) => n.layer === "service")) {
      const name = stem(svc.file || "");
      if (
        content.includes(name) ||
        content.includes(basename(svc.file || "")) ||
        (/auth/i.test(api.route || "") && /auth/i.test(svc.file || "")) ||
        (/user/i.test(api.route || "") && /user/i.test(svc.file || "")) ||
        (/post/i.test(api.route || "") && /post/i.test(svc.file || ""))
      ) {
        edges.push({
          id: `e${edgeN++}`,
          from: api.id,
          to: svc.id,
          kind: svc.health === "critical" ? "broken" : "flow",
        });
      }
    }
  }

  for (const svc of nodes.filter((n) => n.layer === "service")) {
    const content = contentByPath.get(svc.file || "") || "";
    if (hasDbUsage(content) || /user|auth|profile|post|order/i.test(svc.file || "")) {
      edges.push({
        id: `e${edgeN++}`,
        from: svc.id,
        to: "ext:database",
        kind: deps.hasDbPackage || hasDbUsage(content) ? "flow" : "missing",
      });
    }
    if (/auth/i.test(svc.file || "")) {
      edges.push({
        id: `e${edgeN++}`,
        from: svc.id,
        to: "ext:auth-provider",
        kind: deps.hasAuthPackage ? "flow" : "missing",
      });
    }
  }

  // --- Findings from node health + deeper patterns ---
  const findingIds = new Set<string>();

  const addFinding = (f: LogicalFinding) => {
    if (findingIds.has(f.id)) return;
    findingIds.add(f.id);
    findings.push(f);
  };

  for (const api of nodes.filter((n) => n.layer === "api")) {
    const content = contentByPath.get(api.file || "") || "";
    if (/login|signin/i.test(api.route || "") && alwaysSucceeds(content)) {
      const idx = content.search(/success\s*:\s*true|NextResponse\.json/i);
      const startLine = idx >= 0 ? lineOf(content, idx) : 1;
      const fe = nodes.find(
        (n) => n.layer === "frontend" && /login|signin/i.test(n.route || ""),
      );
      const svc = nodes.find(
        (n) => n.layer === "service" && /auth/i.test(n.file || ""),
      );
      const flow = [
        fe?.label || "Login Page",
        api.label,
        svc?.label || "auth service",
      ];
      const nodeIds = [fe?.id, api.id, svc?.id].filter(Boolean) as string[];
      addFinding({
        id: "login-no-verify",
        title: "Login accepts any username and password",
        severity: "critical",
        status: "confirmed",
        category: "Authentication",
        summary:
          "The login path returns success without verifying credentials against a user store.",
        inferredIntent:
          "Users expect login to reject invalid credentials and establish an authenticated session.",
        contradiction:
          "Handler returns success without password verification or session creation evidence.",
        flow,
        nodeIds,
        evidence: [
          {
            file: api.file || "",
            startLine,
            endLine: startLine + 8,
            snippet: excerpt(content, startLine, startLine + 8),
            note: "Always-success response without verification",
          },
        ],
        fixSuggestion:
          "Validate credentials against a user store (hash compare), create a session/JWT on success, and return 401 on failure.",
      });
      if (fe) fe.health = "critical";
      if (svc) {
        svc.health = "critical";
        svc.note = svc.note || "Returns success without verification";
      }
    }

    if (
      /signup|sign-up|register/i.test(api.route || "") &&
      !hasDbUsage(content) &&
      (alwaysSucceeds(content) || /success\s*:\s*true/i.test(content))
    ) {
      const fe = nodes.find(
        (n) =>
          n.layer === "frontend" && /signup|sign-up|register/i.test(n.route || ""),
      );
      const svc = nodes.find(
        (n) => n.layer === "service" && /user|auth/i.test(n.file || ""),
      );
      const idx = content.search(/success\s*:\s*true|NextResponse\.json/i);
      const startLine = idx >= 0 ? lineOf(content, idx) : 1;
      addFinding({
        id: "signup-no-persist",
        title: "Sign up does not create a user",
        severity: "critical",
        status: "confirmed",
        category: "Authentication",
        summary:
          "Sign-up UI implies account creation, but the handler does not persist a user record.",
        inferredIntent:
          "New users expect registration to store their account for later login.",
        contradiction:
          "No database/create/insert usage found on the sign-up path; response still reports success.",
        flow: [
          fe?.label || "Sign Up Page",
          api.label,
          svc?.label || "user service",
        ],
        nodeIds: [fe?.id, api.id, svc?.id].filter(Boolean) as string[],
        evidence: [
          {
            file: api.file || "",
            startLine,
            endLine: startLine + 8,
            snippet: excerpt(content, startLine, startLine + 8),
            note: "Success without persistence",
          },
        ],
        fixSuggestion:
          "Insert a user record (with hashed password) before returning success; handle duplicate email conflicts.",
      });
      if (fe) fe.health = "critical";
      if (svc) {
        svc.health = "critical";
        svc.note = "No database integration found";
      }
    }

    if (
      /user|profile|me/i.test(api.route || "") &&
      !hasAuthGuard(content) &&
      !/public/i.test(api.route || "")
    ) {
      addFinding({
        id: `api-no-auth:${api.id}`,
        title: `${api.label} has no authentication check`,
        severity: "medium",
        status: "likely",
        category: "Data Access",
        summary:
          "User/data endpoint appears reachable without an auth guard in the handler.",
        inferredIntent:
          "Private user data should only be available to authenticated callers.",
        contradiction:
          "No session/auth guard patterns found in the route handler.",
        flow: [api.label],
        nodeIds: [api.id],
        evidence: [
          {
            file: api.file || "",
            snippet: content.slice(0, 400),
            note: "Missing auth guard signals",
          },
        ],
        fixSuggestion:
          "Require a session or bearer token and return 401 when unauthenticated.",
      });
      if (api.health === "ok") api.health = "warning";
    }
  }

  // Dashboard without middleware auth
  const dashboard = nodes.find(
    (n) => n.layer === "frontend" && /dashboard/i.test(n.route || ""),
  );
  const middleware = input.files.find((f) =>
    /(^|\/)middleware\.(ts|js)$/.test(f.path),
  );
  if (dashboard) {
    const mw = middleware?.content || "";
    const pageContent = contentByPath.get(dashboard.file || "") || "";
    if (!hasAuthGuard(mw) && !hasAuthGuard(pageContent)) {
      dashboard.health = "warning";
      addFinding({
        id: "dashboard-no-auth",
        title: "Dashboard accessible without authentication",
        severity: "high",
        status: "likely",
        category: "Authorization",
        summary:
          "A dashboard route exists, but no middleware/page-level auth guard was found.",
        inferredIntent:
          "Dashboard implies a private area for signed-in users only.",
        contradiction:
          "No auth/session guard detected on middleware or the dashboard page.",
        flow: [dashboard.label],
        nodeIds: [dashboard.id],
        evidence: [
          {
            file: dashboard.file || "",
            snippet: pageContent.slice(0, 350),
            note: "Page without auth guard",
          },
          ...(middleware
            ? [
                {
                  file: middleware.path,
                  snippet: mw.slice(0, 350),
                  note: "Middleware lacks auth patterns",
                },
              ]
            : [
                {
                  file: "middleware.ts",
                  snippet: "// middleware.ts not found in scanned files",
                  note: "Missing middleware",
                },
              ]),
        ],
        fixSuggestion:
          "Protect /dashboard (and related routes) with middleware that redirects unauthenticated users to /login.",
      });
    }
  }

  if (!deps.hasDbPackage) {
    const promisesUsers = nodes.some(
      (n) =>
        /login|signup|profile|user|dashboard/i.test(
          `${n.route || ""} ${n.label}`,
        ),
    );
    if (promisesUsers) {
      addFinding({
        id: "no-database",
        title: "No database found",
        severity: "critical",
        status: "likely",
        category: "Infrastructure",
        summary:
          "UI/routes imply persisted users or data, but no database client/dependency was detected.",
        inferredIntent:
          "Features like signup, profile, and posts imply durable storage.",
        contradiction:
          "No Prisma/Drizzle/Supabase/Mongo/etc. usage found in dependencies or scanned sources.",
        flow: ["Application", "Database"],
        nodeIds: ["ext:database"],
        evidence: [
          {
            file: "package.json",
            snippet: deps.packages.slice(0, 30).join(", ") || "No DB packages detected",
            note: "Dependency scan",
          },
        ],
        fixSuggestion:
          "Add a database (or BaaS) and wire create/read paths for users and domain entities.",
        relatedFindingIds: ["signup-no-persist", "user-not-persisted"],
      });
      const db = nodeById.get("ext:database");
      if (db) db.health = "missing";
    }
  }

  if (!deps.hasAuthPackage) {
    const hasAuthUi = nodes.some(
      (n) =>
        n.layer === "frontend" && /login|signup|auth/i.test(n.route || ""),
    );
    if (hasAuthUi) {
      addFinding({
        id: "no-auth-provider",
        title: "No authentication provider configured",
        severity: "high",
        status: "likely",
        category: "Authentication",
        summary:
          "Login/signup UI exists without a detected auth library or provider integration.",
        inferredIntent:
          "Auth screens promise real identity and session management.",
        contradiction:
          "No NextAuth/Clerk/Supabase Auth/etc. dependency or strong verify patterns found.",
        flow: ["Login Page", "Authentication Provider"],
        nodeIds: ["ext:auth-provider"],
        evidence: [
          {
            file: "package.json",
            snippet: "No auth provider package detected in scanned dependencies",
          },
        ],
        fixSuggestion:
          "Integrate an auth provider or implement secure credential + session handling end-to-end.",
      });
    }
  }

  // Profile save without persistence
  const profilePage = nodes.find(
    (n) =>
      n.layer === "frontend" && /profile|settings|account/i.test(n.route || ""),
  );
  if (profilePage) {
    const content = contentByPath.get(profilePage.file || "") || "";
    const mentionsSave = /save|update profile|submit/i.test(content);
    const targets = collectFetchTargets(content);
    const relatedApis = nodes.filter(
      (n) =>
        n.layer === "api" &&
        targets.some((t) => (n.route || "").includes(normalizeApiPath(t))) ||
        /profile|user|settings/i.test(n.route || ""),
    );
    const anyPersist = relatedApis.some((api) =>
      hasDbUsage(contentByPath.get(api.file || "") || ""),
    );
    if (mentionsSave && !anyPersist && !deps.hasDbPackage) {
      addFinding({
        id: "user-not-persisted",
        title: "User data is not persisted",
        severity: "high",
        status: "likely",
        category: "Data Persistence",
        summary:
          "Profile/settings UI suggests editable user data, but no persistence path was found.",
        inferredIntent:
          "Users expect Save/Update on profile fields to persist after reload.",
        contradiction:
          "No database write found on related APIs; storage dependency also missing.",
        flow: [profilePage.label, ...relatedApis.map((a) => a.label).slice(0, 2)],
        nodeIds: [profilePage.id, ...relatedApis.map((a) => a.id)],
        evidence: [
          {
            file: profilePage.file || "",
            snippet: content.slice(0, 400),
            note: "UI implies saveable profile",
          },
        ],
        fixSuggestion:
          "Wire the save action to an API that updates the user record and reload from that store.",
      });
    }
  }

  if (!deps.hasStoragePackage) {
    const uploadUi = input.files.some((f) =>
      /type=["']file["']|upload|FormData|cloudinary|s3/i.test(f.content),
    );
    if (uploadUi) {
      addFinding({
        id: "no-file-storage",
        title: "File storage not configured",
        severity: "medium",
        status: "unknown",
        category: "File Upload",
        summary:
          "Upload UI/patterns appear present without a configured storage provider in the repo.",
        inferredIntent: "Upload controls imply files should be stored durably.",
        contradiction:
          "No S3/UploadThing/Cloudinary-style dependency found; uploads may be local-only or unfinished.",
        flow: ["Upload UI", "File Storage"],
        nodeIds: ["ext:storage"],
        evidence: [
          {
            file: "package.json",
            snippet: "No storage package detected",
          },
        ],
        fixSuggestion:
          "Configure object storage and send uploads through a signed/API path that persists files.",
      });
    }
  }

  // Posts publicly accessible
  const postsApi = nodes.find(
    (n) => n.layer === "api" && /posts|feed/i.test(n.route || ""),
  );
  if (postsApi) {
    const content = contentByPath.get(postsApi.file || "") || "";
    if (!hasAuthGuard(content)) {
      addFinding({
        id: "posts-public",
        title: "Posts are publicly accessible",
        severity: "medium",
        status: "likely",
        category: "Data Access",
        summary:
          "Posts endpoint has no auth guard; treat as public only if that matches product intent.",
        inferredIntent:
          "If the product is a private app, posts should require authentication.",
        contradiction:
          "GET posts handler lacks session/auth checks in the scanned source.",
        flow: [postsApi.label],
        nodeIds: [postsApi.id],
        evidence: [
          {
            file: postsApi.file || "",
            snippet: content.slice(0, 400),
          },
        ],
        fixSuggestion:
          "If posts are private, require auth; if public-by-design, document that and mark the finding dismissed.",
      });
      if (postsApi.health === "ok") {
        postsApi.health = "warning";
        postsApi.note = "No authentication check";
      }
    } else if (postsApi.health === "ok") {
      postsApi.note = "Fetches posts correctly";
    }
  }

  // Propagate critical from findings onto connected frontend nodes
  for (const f of findings) {
    if (f.severity !== "critical" && f.severity !== "high") continue;
    for (const id of f.nodeIds) {
      const n = nodeById.get(id);
      if (!n) continue;
      if (f.severity === "critical" && n.health !== "missing") {
        if (n.health !== "critical") n.health = "critical";
      } else if (f.severity === "high" && n.health === "ok") {
        n.health = "warning";
      }
    }
  }

  // Sort findings: critical → high → medium
  const sev = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort(
    (a, b) => sev[a.severity] - sev[b.severity] || a.title.localeCompare(b.title),
  );

  return {
    nodes,
    edges: edges.slice(0, 80),
    findings: findings.slice(0, 40),
    source: "heuristic",
    analyzedAt: new Date().toISOString(),
  };
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced?.[1]?.trim() || trimmed;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  return JSON.parse(text);
}

const aiReportSchema = z.object({
  findings: z.array(findingSchema).max(24).optional(),
  nodePatches: z
    .array(
      z.object({
        id: z.string(),
        health: z.enum(["ok", "critical", "warning", "unused", "missing"]),
        note: z.string().optional(),
      }),
    )
    .max(40)
    .optional(),
});

/**
 * Level 2 — reasoning over compact graphs + snippets.
 * Infers intent and contradictions; never asks the developer.
 */
export async function enrichArchitectureWithAi(
  report: ArchitectureReport,
  context: {
    fullName: string;
    pages: PageSummary[];
    features: FeatureFlow[];
    snippets: Array<{ path: string; excerpt: string }>;
  },
): Promise<ArchitectureReport> {
  try {
    const cfg = getLlmConfig();
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    const completion = await client.chat.completions.create({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 2400,
      messages: [
        {
          role: "system",
          content: `You are an automatic Next.js repository analyzer.
Do NOT ask what the developer intended. Infer purpose from UI, routes, APIs, models, dependencies, and code behavior.
Find contradictions between what the app promises and what it implements.

Return ONLY JSON:
{
  "findings":[{
    "id","title","severity":"critical|high|medium|low",
    "status":"confirmed|likely|unknown",
    "category","summary","inferredIntent","contradiction",
    "flow":["Login Page","POST /api/auth/login","auth.ts"],
    "nodeIds":["..."],
    "evidence":[{"file","startLine","endLine","snippet","note"}],
    "fixSuggestion","relatedFindingIds"
  }],
  "nodePatches":[{"id","health","note"}]
}

Status rules:
- confirmed: decisive code evidence in snippets (e.g. always success:true with no verify)
- likely: strong structural evidence but not airtight
- unknown: cannot verify from repo alone (demo/external service possible)

Prefer refining/extending the seed findings. Do not invent files. Max 16 findings.`,
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              repo: context.fullName,
              seedFindings: report.findings.slice(0, 16),
              nodes: report.nodes.slice(0, 40),
              edges: report.edges.slice(0, 40),
              pages: context.pages.slice(0, 16),
              features: context.features.slice(0, 8),
              snippets: context.snippets.slice(0, 18),
            },
            null,
            2,
          ),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = aiReportSchema.parse(extractJson(raw));
    const byId = new Map(report.findings.map((f) => [f.id, f]));
    for (const f of parsed.findings || []) {
      byId.set(f.id, f);
    }
    const nodes = report.nodes.map((n) => {
      const patch = parsed.nodePatches?.find((p) => p.id === n.id);
      if (!patch) return n;
      return { ...n, health: patch.health, note: patch.note ?? n.note };
    });
    const findings = [...byId.values()];
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    findings.sort(
      (a, b) => sev[a.severity] - sev[b.severity] || a.title.localeCompare(b.title),
    );
    return {
      ...report,
      nodes,
      findings: findings.slice(0, 40),
      source: "ai",
      analyzedAt: new Date().toISOString(),
    };
  } catch {
    return report;
  }
}

/** Attach architecture report onto a DataIndex (mutates copy). */
export async function attachArchitectureAnalysis(
  index: DataIndex,
  analysis: RepoAnalysis,
  files: RepoSourceFile[],
): Promise<DataIndex> {
  let report = buildArchitectureReport({
    analysis,
    files,
    records: index.records,
    pages: index.pages,
    features: index.features,
  });

  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const paths = [
    ...new Set([
      ...report.findings.flatMap((f) => f.evidence.map((e) => e.file)),
      ...report.nodes.map((n) => n.file).filter(Boolean) as string[],
    ]),
  ].slice(0, 20);

  report = await enrichArchitectureWithAi(report, {
    fullName: index.fullName,
    pages: index.pages,
    features: index.features,
    snippets: paths.map((path) => ({
      path,
      excerpt: (byPath.get(path) || "").slice(0, 1400),
    })),
  });

  return {
    ...index,
    architecture: report,
  };
}

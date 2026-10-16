import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";

export type ComponentCard = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  confidence: number;
  evidence: Array<{ path: string; hint: string }>;
};

type Detector = {
  kind: string;
  title: string;
  summary: string;
  /** Path and content both scored; hits accumulate into one card. */
  score: (
    path: string,
    content: string,
  ) => {
    points: number;
    hint: string;
  } | null;
};

function clipHint(line: string): string {
  const cleaned = line.replace(/\s+/g, " ").trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
}

function firstMatchingLine(content: string, re: RegExp): string | null {
  for (const line of content.split("\n")) {
    if (re.test(line)) return clipHint(line);
  }
  return null;
}

const DETECTORS: Detector[] = [
  {
    kind: "login",
    title: "Login form",
    summary: "Sign-in UI for authenticating users.",
    score(path, content) {
      const pathHit =
        /(^|\/)(login|sign-?in|signin)(\.|\/)/i.test(path) ||
        /login|sign-?in/i.test(path);
      const contentHit =
        /type=["']password["']/i.test(content) &&
        /(sign\s*in|log\s*in|email|username)/i.test(content);
      const named =
        /\b(LoginForm|SignInForm|LoginPage|SignInPage|AuthForm)\b/.test(
          content,
        );
      if (!pathHit && !contentHit && !named) return null;
      let points = 0;
      if (pathHit) points += 3;
      if (contentHit) points += 4;
      if (named) points += 3;
      if (/forgot\s*password|remember\s*me/i.test(content)) points += 1;
      const hint =
        firstMatchingLine(
          content,
          /password|sign\s*in|log\s*in|LoginForm|SignIn/i,
        ) || path;
      return { points, hint };
    },
  },
  {
    kind: "signup",
    title: "Sign up form",
    summary: "Registration UI for creating new accounts.",
    score(path, content) {
      const pathHit = /(sign-?up|register|registration)/i.test(path);
      const named = /\b(SignUpForm|RegisterForm|SignupPage|RegisterPage)\b/.test(
        content,
      );
      const contentHit =
        /(sign\s*up|create\s*account|register)/i.test(content) &&
        /type=["']password["']/i.test(content);
      if (!pathHit && !named && !contentHit) return null;
      let points = 0;
      if (pathHit) points += 3;
      if (named) points += 3;
      if (contentHit) points += 3;
      return {
        points,
        hint:
          firstMatchingLine(content, /sign\s*up|register|password/i) || path,
      };
    },
  },
  {
    kind: "search",
    title: "Search",
    summary: "Search input or query UI for finding content.",
    score(path, content) {
      const pathHit = /search/i.test(path);
      const named =
        /\b(SearchBar|SearchInput|SearchBox|RepoSearch|GlobalSearch)\b/.test(
          content,
        );
      const contentHit =
        /type=["']search["']/i.test(content) ||
        /placeholder=["'][^"']*search/i.test(content) ||
        /\buseSearchParams\b|\bsearchParams\b|\bquery\b.*\b(filter|search)/i.test(
          content,
        );
      if (!pathHit && !named && !contentHit) return null;
      // Avoid scoring every page that mentions "query" lightly.
      let points = 0;
      if (pathHit) points += 2;
      if (named) points += 4;
      if (/type=["']search["']/i.test(content)) points += 4;
      if (/placeholder=["'][^"']*search/i.test(content)) points += 3;
      if (/\buseSearchParams\b/.test(content)) points += 2;
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(
            content,
            /search|useSearchParams|SearchBar|placeholder/i,
          ) || path,
      };
    },
  },
  {
    kind: "navigation",
    title: "Navigation",
    summary: "Primary nav, sidebar, or app header links.",
    score(path, content) {
      const pathHit = /(navbar|nav-bar|sidebar|app-?header|navigation)/i.test(
        path,
      );
      const named =
        /\b(Navbar|NavBar|SideNav|Sidebar|AppHeader|MainNav|BottomNav)\b/.test(
          content,
        );
      const contentHit =
        /<(nav|aside)\b/i.test(content) &&
        /(Link|href=|router\.push)/i.test(content);
      if (!pathHit && !named && !contentHit) return null;
      let points = 0;
      if (pathHit) points += 3;
      if (named) points += 3;
      if (contentHit) points += 2;
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(content, /Navbar|Sidebar|AppHeader|<nav|href=/i) ||
          path,
      };
    },
  },
  {
    kind: "dashboard",
    title: "Dashboard",
    summary: "Overview or analytics surface for the product.",
    score(path, content) {
      const pathHit = /dashboard|analytics|overview/i.test(path);
      const named = /\b(Dashboard|AnalyticsPage|OverviewPanel)\b/.test(content);
      if (!pathHit && !named) return null;
      return {
        points: (pathHit ? 3 : 0) + (named ? 3 : 0),
        hint:
          firstMatchingLine(content, /dashboard|analytics|overview/i) || path,
      };
    },
  },
  {
    kind: "profile",
    title: "Profile & settings",
    summary: "Account, profile, or settings screens.",
    score(path, content) {
      const pathHit = /(profile|settings|account)/i.test(path);
      const named =
        /\b(ProfilePage|SettingsPage|AccountSettings|UserProfile)\b/.test(
          content,
        );
      if (!pathHit && !named) return null;
      return {
        points: (pathHit ? 2 : 0) + (named ? 3 : 0) + (/settings/i.test(path) ? 1 : 0),
        hint:
          firstMatchingLine(content, /profile|settings|account/i) || path,
      };
    },
  },
  {
    kind: "checkout",
    title: "Cart & checkout",
    summary: "Shopping cart or checkout / payment flow.",
    score(path, content) {
      const pathHit = /(cart|checkout|payment|billing)/i.test(path);
      const named = /\b(Checkout|CartPage|PaymentForm|BillingForm)\b/.test(
        content,
      );
      const contentHit =
        /\b(stripe|paypal|checkout|addToCart|paymentIntent)\b/i.test(content);
      if (!pathHit && !named && !contentHit) return null;
      let points = 0;
      if (pathHit) points += 3;
      if (named) points += 3;
      if (contentHit) points += 2;
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(
            content,
            /checkout|cart|stripe|payment|billing/i,
          ) || path,
      };
    },
  },
  {
    kind: "chat",
    title: "Chat / messaging",
    summary: "Conversation or messaging UI.",
    score(path, content) {
      const pathHit = /(chat|message|inbox|conversation)/i.test(path);
      const named = /\b(ChatWindow|MessageList|Conversation|ChatPanel)\b/.test(
        content,
      );
      const contentHit =
        /\b(sendMessage|onSend|messages\.map|chatHistory)\b/.test(content);
      if (!pathHit && !named && !contentHit) return null;
      let points = (pathHit ? 2 : 0) + (named ? 3 : 0) + (contentHit ? 2 : 0);
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(content, /chat|message|conversation|send/i) ||
          path,
      };
    },
  },
  {
    kind: "upload",
    title: "File upload",
    summary: "File picker, dropzone, or media upload.",
    score(path, content) {
      const pathHit = /upload|dropzone|file-?input/i.test(path);
      const contentHit =
        /type=["']file["']/i.test(content) ||
        /\b(Dropzone|useDropzone|onDrop|FormData)\b/.test(content);
      if (!pathHit && !contentHit) return null;
      let points = (pathHit ? 3 : 0) + (contentHit ? 3 : 0);
      return {
        points,
        hint:
          firstMatchingLine(content, /file|dropzone|upload|FormData/i) || path,
      };
    },
  },
  {
    kind: "modal",
    title: "Modal / dialog",
    summary: "Overlay dialogs for confirmations or focused tasks.",
    score(path, content) {
      const pathHit = /(modal|dialog)/i.test(path);
      const named = /\b(Dialog|Modal|AlertDialog|Sheet)\b/.test(content);
      const contentHit =
        /role=["']dialog["']|data-state=.*open|<Dialog[\s>]/i.test(content);
      if (!pathHit && !named && !contentHit) return null;
      let points = (pathHit ? 2 : 0) + (named ? 2 : 0) + (contentHit ? 2 : 0);
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(content, /Dialog|Modal|dialog|Sheet/i) || path,
      };
    },
  },
  {
    kind: "data-table",
    title: "Data table",
    summary: "Tabular list or data grid for records.",
    score(path, content) {
      const pathHit = /(table|datagrid|data-table)/i.test(path);
      const named = /\b(DataTable|DataGrid|TanStackTable)\b/.test(content);
      const contentHit =
        /<table\b/i.test(content) ||
        /\b(useReactTable|ColumnDef|getCoreRowModel)\b/.test(content);
      if (!pathHit && !named && !contentHit) return null;
      let points = (pathHit ? 2 : 0) + (named ? 3 : 0) + (contentHit ? 2 : 0);
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(content, /table|DataTable|ColumnDef|<th/i) || path,
      };
    },
  },
  {
    kind: "auth",
    title: "Auth session",
    summary: "Auth provider, session, or OAuth wiring.",
    score(path, content) {
      const pathHit = /(auth|session|oauth|supabase)/i.test(path);
      const contentHit =
        /\b(AuthProvider|useSession|next-auth|createClient|signIn\(|signOut\(|getSession)\b/.test(
          content,
        ) || /supabase\.auth/i.test(content);
      if (!pathHit && !contentHit) return null;
      let points = (pathHit ? 1 : 0) + (contentHit ? 3 : 0);
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(
            content,
            /AuthProvider|useSession|signIn|supabase\.auth|next-auth/i,
          ) || path,
      };
    },
  },
  {
    kind: "api-route",
    title: "API routes",
    summary: "Backend HTTP handlers exposed by the app.",
    score(path, content) {
      const pathHit =
        /(^|\/)(app\/api|pages\/api|api\/routes|controllers|handlers)\//i.test(
          path,
        ) || /route\.(ts|js)$/i.test(path);
      if (!pathHit) return null;
      const exportHit =
        /\b(export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)|router\.(get|post)|@app\.(get|post))\b/.test(
          content,
        );
      return {
        points: 2 + (exportHit ? 2 : 0),
        hint:
          firstMatchingLine(
            content,
            /export\s+(async\s+)?function\s+(GET|POST)|router\.|@app\./i,
          ) || path,
      };
    },
  },
  {
    kind: "form",
    title: "Form",
    summary: "General form submission UI found in the codebase.",
    score(path, content) {
      // Only when not already a stronger form kind — caller filters overlap lightly.
      const named = /\b\w+Form\b/.test(content) && /\.tsx?$|\.jsx?$/.test(path);
      const contentHit =
        /<form\b/i.test(content) ||
        /\b(useForm|handleSubmit|onSubmit)\b/.test(content);
      if (!named && !contentHit) return null;
      if (/(login|sign-?up|register|checkout|payment)/i.test(path + content)) {
        // Prefer dedicated detectors.
        if (!named) return null;
      }
      let points = (named ? 2 : 0) + (contentHit ? 2 : 0);
      if (/type=["'](email|text|password|number)["']/i.test(content)) points += 1;
      if (points < 3) return null;
      return {
        points,
        hint:
          firstMatchingLine(content, /<form|useForm|handleSubmit|Form\b/i) ||
          path,
      };
    },
  },
];

/** Also surface notable named UI components as their own cards. */
function namedComponentCards(files: RepoSourceFile[]): ComponentCard[] {
  const cards: ComponentCard[] = [];
  const seen = new Set<string>();
  const re =
    /(?:export\s+(?:default\s+)?(?:function|const)\s+|function\s+)([A-Z][A-Za-z0-9]*(?:Form|Modal|Dialog|Panel|Page|Bar|Table|Drawer|Sheet|Wizard))\b/g;

  for (const file of files) {
    if (!/\.(tsx|jsx|vue|svelte)$/i.test(file.path)) continue;
    let match: RegExpExecArray | null;
    const local = new Set<string>();
    while ((match = re.exec(file.content)) !== null) {
      const full = match[1];
      if (!full || local.has(full)) continue;
      local.add(full);
      const key = full.toLowerCase();
      if (seen.has(key)) continue;
      if (
        /^(Login|SignIn|SignUp|Register|Search|Checkout|Cart|Navbar|Sidebar)/i.test(
          full,
        )
      ) {
        continue;
      }
      seen.add(key);
      cards.push({
        id: `component:${key}`,
        kind: "component",
        title: full,
        summary: `UI component detected in ${file.path}.`,
        confidence: 0.55,
        evidence: [{ path: file.path, hint: clipHint(match[0]) }],
      });
    }
  }
  return cards.slice(0, 24);
}

export function scanComponentCards(files: RepoSourceFile[]): ComponentCard[] {
  type Acc = {
    kind: string;
    title: string;
    summary: string;
    points: number;
    evidence: Array<{ path: string; hint: string }>;
  };
  const byKind = new Map<string, Acc>();

  for (const file of files) {
    for (const detector of DETECTORS) {
      const hit = detector.score(file.path, file.content);
      if (!hit || hit.points <= 0) continue;
      const existing = byKind.get(detector.kind);
      if (!existing) {
        byKind.set(detector.kind, {
          kind: detector.kind,
          title: detector.title,
          summary: detector.summary,
          points: hit.points,
          evidence: [{ path: file.path, hint: hit.hint }],
        });
      } else {
        existing.points += hit.points;
        if (existing.evidence.length < 6) {
          existing.evidence.push({ path: file.path, hint: hit.hint });
        }
      }
    }
  }

  const featureCards: ComponentCard[] = [...byKind.values()]
    .filter((acc) => acc.points >= 3)
    .map((acc) => ({
      id: `feature:${acc.kind}`,
      kind: acc.kind,
      title: acc.title,
      summary: acc.summary,
      confidence: Math.min(0.98, 0.35 + acc.points * 0.05),
      evidence: acc.evidence,
    }))
    .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title));

  // Drop generic "form" if we already have login/signup/checkout.
  const kinds = new Set(featureCards.map((c) => c.kind));
  const filtered = featureCards.filter((card) => {
    if (card.kind !== "form") return true;
    return !(kinds.has("login") || kinds.has("signup") || kinds.has("checkout"));
  });

  const named = namedComponentCards(files).filter((card) => {
    // Avoid duplicating feature titles.
    const title = card.title.toLowerCase();
    return !filtered.some(
      (f) =>
        f.title.toLowerCase().includes(title) ||
        title.includes(f.kind.replace("-", "")),
    );
  });

  return [...filtered, ...named].slice(0, 48);
}

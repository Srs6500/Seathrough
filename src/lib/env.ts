/**
 * Server-side env access. Never log values — only presence / names.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export type LlmProviderName = "groq" | "openai";

/** Groq retired these ids; keep old .env values working. */
const GROQ_MODEL_REPLACEMENTS: Record<string, string> = {
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama-3.1-70b-versatile": "openai/gpt-oss-120b",
  "meta-llama/llama-4-scout-17b-16e-instruct": "qwen/qwen3.6-27b",
};

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

function resolveGroqModel(requested?: string): string {
  const id = requested?.trim() || DEFAULT_GROQ_MODEL;
  const resolved = GROQ_MODEL_REPLACEMENTS[id] ?? id;
  if (resolved !== id) {
    console.warn(
      `[env] GROQ_MODEL "${id}" is retired on Groq; using "${resolved}" instead.`,
    );
  }
  return resolved;
}

/** Exported for smokes — maps retired Groq ids onto a live model. */
export function groqModelOrReplacement(requested?: string): string {
  return resolveGroqModel(requested);
}

export function getLlmConfig() {
  const provider = (optional("LLM_PROVIDER") ?? "groq").toLowerCase() as LlmProviderName;

  if (provider === "openai") {
    return {
      provider: "openai" as const,
      apiKey: required("OPENAI_API_KEY"),
      model: optional("OPENAI_MODEL") ?? "gpt-4.1",
      baseURL: undefined as string | undefined,
    };
  }

  return {
    provider: "groq" as const,
    apiKey: required("GROQ_API_KEY"),
    model: resolveGroqModel(optional("GROQ_MODEL")),
    baseURL: "https://api.groq.com/openai/v1",
  };
}

/**
 * Film writer for /video. Optional EXPLAIN_VIDEO_* vars point it at any OpenAI-compatible
 * endpoint (a stronger code model) without changing the rest of the app; otherwise it uses
 * the app's LLM. `tokensPerMinute` is the per-request ceiling (prompt + output) to stay under,
 * or null when the provider has no tight per-minute cap.
 */
export function getExplainVideoLlmConfig() {
  const apiKey = optional("EXPLAIN_VIDEO_API_KEY");
  const tpmOverride = Number(optional("EXPLAIN_VIDEO_TPM") ?? "");
  const tpm = Number.isFinite(tpmOverride) && tpmOverride > 0 ? tpmOverride : null;
  if (apiKey) {
    return {
      apiKey,
      baseURL: optional("EXPLAIN_VIDEO_BASE_URL"),
      model: optional("EXPLAIN_VIDEO_MODEL") ?? "gpt-4.1",
      groq: (optional("EXPLAIN_VIDEO_BASE_URL") ?? "").includes("groq.com"),
      tokensPerMinute: tpm,
    };
  }
  const base = getLlmConfig();
  const groq = base.provider === "groq";
  return {
    apiKey: base.apiKey,
    baseURL: base.baseURL,
    model: optional("EXPLAIN_VIDEO_MODEL") ?? base.model,
    groq,
    tokensPerMinute: tpm ?? (groq ? 8000 : null),
  };
}

/**
 * Multimodal / vision model for screenshot extraction.
 * Prefers OpenAI when configured; otherwise Groq vision (Qwen 3.6).
 * Note: meta-llama/llama-4-scout-17b-16e-instruct was shut down on Groq 2026-07-17.
 */
export function getVisionLlmConfig() {
  const openaiKey = optional("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      provider: "openai" as const,
      apiKey: openaiKey,
      model: optional("OPENAI_VISION_MODEL") ?? optional("OPENAI_MODEL") ?? "gpt-4.1",
      baseURL: undefined as string | undefined,
    };
  }

  return {
    provider: "groq" as const,
    apiKey: required("GROQ_API_KEY"),
    model: optional("GROQ_VISION_MODEL") ?? "qwen/qwen3.6-27b",
    baseURL: "https://api.groq.com/openai/v1",
  };
}

export function getDeepgramConfig() {
  return {
    apiKey: required("DEEPGRAM_API_KEY"),
    model: optional("DEEPGRAM_TTS_MODEL") ?? "aura-2-thalia-en",
    sttModel: optional("DEEPGRAM_STT_MODEL") ?? "nova-2",
  };
}

export function getTavilyConfig() {
  return {
    apiKey: optional("TAVILY_API_KEY"),
  };
}

/** Cloud browser for /browser (Browserbase). Optional — local Playwright can be used instead. */
export function getBrowserbaseConfig() {
  return {
    apiKey: optional("BROWSERBASE_API_KEY"),
    projectId: optional("BROWSERBASE_PROJECT_ID"),
  };
}

/**
 * Cloud browser alternative (Browserless).
 * When BROWSERLESS_API_KEY is set it is preferred over Browserbase.
 */
export function getBrowserlessConfig() {
  return {
    apiKey: optional("BROWSERLESS_API_KEY"),
    /** e.g. wss://production-sfo.browserless.io or wss://production-lon.browserless.io */
    wsEndpoint: optional("BROWSERLESS_WS_ENDPOINT"),
  };
}

export function getSupabaseConfig() {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

/**
 * GitHub App for Bug Analyzer / data-flow repo connect.
 * Private key may be stored with literal \n in env dashboards.
 */
export function getGithubAppConfig() {
  const appId = optional("GITHUB_APP_ID");
  const slug = optional("GITHUB_APP_SLUG");
  const rawKey = optional("GITHUB_APP_PRIVATE_KEY");
  let privateKey = "";
  let privateKeyError: string | undefined;
  if (rawKey) {
    privateKey = rawKey.includes("\\n")
      ? rawKey.replace(/\\n/g, "\n")
      : rawKey;
    if (!/BEGIN [A-Z ]*PRIVATE KEY/.test(privateKey)) {
      privateKeyError = "GITHUB_APP_PRIVATE_KEY does not look like a PEM private key";
    }
  }
  const configured = Boolean(appId && slug && privateKey && !privateKeyError);
  return {
    configured,
    appId: appId ?? "",
    slug: slug ?? "",
    privateKey,
    privateKeyError,
    clientId: optional("GITHUB_APP_CLIENT_ID"),
    clientSecret: optional("GITHUB_APP_CLIENT_SECRET"),
    webhookSecret: optional("GITHUB_APP_WEBHOOK_SECRET"),
  };
}

export function envPresence() {
  const imageRefRaw = optional("IMAGE_REFERENCE_ENABLED")?.toLowerCase();
  const imageReferenceExplicitOff =
    imageRefRaw === "0" ||
    imageRefRaw === "false" ||
    imageRefRaw === "off" ||
    imageRefRaw === "no";
  return {
    LLM_PROVIDER: optional("LLM_PROVIDER") ?? "groq",
    GROQ_API_KEY: Boolean(optional("GROQ_API_KEY")),
    OPENAI_API_KEY: Boolean(optional("OPENAI_API_KEY")),
    EXPLAIN_VIDEO_API_KEY: Boolean(optional("EXPLAIN_VIDEO_API_KEY")),
    TAVILY_API_KEY: Boolean(optional("TAVILY_API_KEY")),
    BROWSERBASE_API_KEY: Boolean(optional("BROWSERBASE_API_KEY")),
    BROWSERBASE_PROJECT_ID: Boolean(optional("BROWSERBASE_PROJECT_ID")),
    BROWSERLESS_API_KEY: Boolean(optional("BROWSERLESS_API_KEY")),
    IMAGE_REFERENCE_ENABLED: !imageReferenceExplicitOff,
    DEEPGRAM_API_KEY: Boolean(optional("DEEPGRAM_API_KEY")),
    NEXT_PUBLIC_SUPABASE_URL: Boolean(optional("NEXT_PUBLIC_SUPABASE_URL")),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(optional("NEXT_PUBLIC_SUPABASE_ANON_KEY")),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(optional("SUPABASE_SERVICE_ROLE_KEY")),
    SEETHROUGH_ADMIN_PASSWORD: Boolean(optional("SEETHROUGH_ADMIN_PASSWORD")),
    GITHUB_APP_ID: Boolean(optional("GITHUB_APP_ID")),
    GITHUB_APP_SLUG: Boolean(optional("GITHUB_APP_SLUG")),
    GITHUB_APP_PRIVATE_KEY: Boolean(optional("GITHUB_APP_PRIVATE_KEY")),
  };
}

const DEFAULT_HEADER_DENY = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
];

const SECRET_KEY =
  /(password|passwd|secret|token|api[_-]?key|authorization|cookie|session|private[_-]?key|client[_-]?secret)/i;

export function redactHeaders(
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined,
  extraDeny: string[] = [],
): Record<string, string> {
  const deny = new Set(
    [...DEFAULT_HEADER_DENY, ...extraDeny].map((h) => h.toLowerCase()),
  );
  const out: Record<string, string> = {};
  if (!headers) return out;

  const entries =
    typeof (headers as Headers).forEach === "function"
      ? (() => {
          const list: Array<[string, string]> = [];
          (headers as Headers).forEach((value, key) => list.push([key, value]));
          return list;
        })()
      : Object.entries(headers as Record<string, string | string[] | undefined>).map(
          ([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")] as [string, string],
        );

  for (const [key, value] of entries) {
    if (deny.has(key.toLowerCase()) || SECRET_KEY.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = String(value).slice(0, 500);
    }
  }
  return out;
}

export function redactBodyPreview(raw: unknown, max = 800): string | undefined {
  if (raw == null) return undefined;
  let text: string;
  if (typeof raw === "string") text = raw;
  else {
    try {
      text = JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    text = JSON.stringify(redactValue(parsed));
  } catch {
    // plain text
    if (SECRET_KEY.test(text)) return "[redacted]";
  }
  if (text.length > max) return `${text.slice(0, max)}…`;
  return text;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Normalize / validate a user-entered scan target.
 * Frontend health needs a running HTTP(S) app — not a GitHub repo slug.
 */

export type TargetUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function looksLikeGithubRepoPage(url: URL): boolean {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "github.com" && host !== "githubusercontent.com") return false;
  // github.com/owner/repo[/...] — not a deployed app
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length >= 2;
}

/** Accept bare hostnames by adding https:// */
export function normalizeScanTargetUrl(raw: string): TargetUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Enter the URL of a running app (e.g. http://localhost:3000).",
    };
  }

  // Repo slug like owner/repo — common mistake after picking a GitHub repo
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed) && !trimmed.includes("://")) {
    return {
      ok: false,
      error:
        "That looks like a GitHub repo name, not a running app. Paste a deploy or localhost URL, or use Scan demo.",
    };
  }

  let candidate = trimmed;
  // Only treat as absolute if it has a real scheme (http://…), not host:port.
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(candidate)) {
    const isLocal =
      /^localhost\b/i.test(candidate) || /^127\.\d+\.\d+\.\d+\b/.test(candidate);
    candidate = `${isLocal ? "http" : "https"}://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      error: "Invalid URL. Use a full http:// or https:// address.",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: "Only http:// and https:// URLs can be scanned.",
    };
  }

  if (looksLikeGithubRepoPage(parsed)) {
    return {
      ok: false,
      error:
        "That is a GitHub page, not your running frontend. Paste localhost or your deploy URL, or use Scan demo.",
    };
  }

  return { ok: true, url: parsed.toString() };
}

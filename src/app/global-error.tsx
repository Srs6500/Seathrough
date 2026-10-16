"use client";

/**
 * Root error UI — required so Turbopack/RSC has a client error module when
 * the builtin global-error manifest entry fails to resolve.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 32,
          color: "#17324a",
          background: "#f4f8fb",
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: "#5a7388", fontSize: 14, marginBottom: 16 }}>
          {error.message || "Unexpected application error."}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            border: "1px solid #d7e3eb",
            background: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

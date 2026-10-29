"use client";

import { useEffect } from "react";

/** If GitHub sends installation_id to any page, finish Vibe coder connect. */
export function GithubInstallReturn() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const installationId = url.searchParams.get("installation_id");
    if (!installationId) return;
    const next = new URL("/api/vibe-coder/github/callback", window.location.origin);
    next.searchParams.set("installation_id", installationId);
    const state = url.searchParams.get("state");
    if (state) next.searchParams.set("state", state);
    window.location.replace(next.toString());
  }, []);
  return null;
}

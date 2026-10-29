import { NextResponse } from "next/server";
import {
  VIBE_GITHUB_COOKIE,
  vibeGithubCookieOptions,
} from "@/lib/vibe-coder/githubSession";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(VIBE_GITHUB_COOKIE, "", vibeGithubCookieOptions(true));
  return response;
}

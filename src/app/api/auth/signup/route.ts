import { NextResponse } from "next/server";
import {
  emailToUsernameCandidate,
  isValidEmail,
  normalizeEmail,
} from "@/lib/auth/email";
import { ensureProfileForUser } from "@/lib/auth/profile";
import { authEmailRedirectTo } from "@/lib/auth/siteUrl";
import { validatePassword } from "@/lib/auth/username";
import { getAnonSupabase } from "@/lib/supabase/anon";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  email?: string;
  password?: string;
  /** @deprecated username signup — ignored; use email. */
  username?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  const password = body.password ?? "";

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address" },
      { status: 400 },
    );
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const username = emailToUsernameCandidate(email);
  const emailRedirectTo = authEmailRedirectTo(request);

  try {
    const anon = getAnonSupabase();
    const { data, error } = await anon.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: { username },
      },
    });

    if (error) {
      const msg = error.message ?? "Could not create account";
      if (/already|registered|exists/i.test(msg)) {
        return NextResponse.json(
          { error: "An account with that email already exists" },
          { status: 409 },
        );
      }
      console.error("[auth/signup]", msg);
      return NextResponse.json(
        { error: toUserFacingError(msg) },
        { status: 400 },
      );
    }

    if (!data.user) {
      return NextResponse.json(
        { error: "Could not create account" },
        { status: 500 },
      );
    }

    // Profile even when email confirmation is pending (user id exists).
    const profileUsername = await ensureProfileForUser({
      userId: data.user.id,
      email,
      preferredUsername: username,
    });

    // Confirm-email on: no session until they click the link.
    if (!data.session) {
      return NextResponse.json({
        needsConfirmation: true,
        email,
        user: { id: data.user.id, username: profileUsername },
      });
    }

    return NextResponse.json({
      needsConfirmation: false,
      user: {
        id: data.user.id,
        username: profileUsername,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (error) {
    console.error("[auth/signup]", error);
    return NextResponse.json(
      { error: toUserFacingError(error) },
      { status: 500 },
    );
  }
}

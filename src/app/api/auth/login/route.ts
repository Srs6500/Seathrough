import { NextResponse } from "next/server";
import { isValidEmail, normalizeEmail } from "@/lib/auth/email";
import { ensureProfileForUser } from "@/lib/auth/profile";
import {
  isValidUsername,
  normalizeUsername,
  usernameToEmail,
  validatePassword,
} from "@/lib/auth/username";
import { getAnonSupabase } from "@/lib/supabase/anon";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  email?: string;
  password?: string;
  /** Legacy username accounts (pre-email signup). */
  username?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const password = body.password ?? "";
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const rawEmail = (body.email ?? "").trim();
  const rawUsername = (body.username ?? "").trim();

  let email: string;
  if (rawEmail) {
    email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 },
      );
    }
  } else if (rawUsername) {
    // Legacy: username → synthetic email used by older accounts.
    const username = normalizeUsername(rawUsername);
    if (!isValidUsername(username)) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 },
      );
    }
    email = usernameToEmail(username);
  } else {
    return NextResponse.json(
      { error: "Enter a valid email address" },
      { status: 400 },
    );
  }

  try {
    const anon = getAnonSupabase();
    const { data, error } = await anon.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      console.error("[auth/login] signIn failed", {
        email,
        supabaseMessage: error?.message ?? "no session returned",
        supabaseStatus: error?.status ?? null,
        supabaseCode: (error as { code?: string } | null)?.code ?? null,
      });
      const unconfirmed =
        error &&
        /confirm|verification|not confirmed|email not confirmed/i.test(
          error.message,
        );
      return NextResponse.json(
        {
          error: unconfirmed
            ? "Confirm your email before logging in — check your inbox for the link."
            : "Incorrect email or password",
        },
        { status: 401 },
      );
    }

    const username = await ensureProfileForUser({
      userId: data.user.id,
      email: data.user.email ?? email,
      preferredUsername:
        (data.user.user_metadata?.username as string | undefined) ?? null,
    });

    return NextResponse.json({
      user: {
        id: data.user.id,
        username,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (error) {
    console.error("[auth/login]", error);
    return NextResponse.json(
      { error: toUserFacingError(error) },
      { status: 500 },
    );
  }
}

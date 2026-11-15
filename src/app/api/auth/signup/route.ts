import { NextResponse } from "next/server";
import {
  emailToUsernameCandidate,
  isValidEmail,
  normalizeEmail,
} from "@/lib/auth/email";
import { ensureProfileForUser } from "@/lib/auth/profile";
import { authEmailRedirectTo } from "@/lib/auth/siteUrl";
import {
  isValidUsername,
  normalizeUsername,
  usernameToEmail,
  validatePassword,
} from "@/lib/auth/username";
import { getAnonSupabase } from "@/lib/supabase/anon";
import { getServiceSupabase } from "@/lib/supabase/server";
import { toUserFacingError } from "@/lib/errors/userFacing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  /** Email or username — only one needed. */
  identifier?: string;
  email?: string;
  username?: string;
  password?: string;
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

  const identifier =
    (body.identifier ?? "").trim() ||
    (body.email ?? "").trim() ||
    (body.username ?? "").trim();

  if (!identifier) {
    return NextResponse.json(
      { error: "Enter an email or username" },
      { status: 400 },
    );
  }

  const usingEmail = identifier.includes("@");
  let email: string;
  let username: string;

  if (usingEmail) {
    email = normalizeEmail(identifier);
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Enter a valid email or username" },
        { status: 400 },
      );
    }
    username = emailToUsernameCandidate(email);
  } else {
    username = normalizeUsername(identifier);
    if (!isValidUsername(username)) {
      return NextResponse.json(
        {
          error:
            "Username must be 3–24 characters: letters, numbers, or underscore",
        },
        { status: 400 },
      );
    }
    email = usernameToEmail(username);
  }

  try {
    const service = getServiceSupabase();
    const { data: existing } = await service
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          error: usingEmail
            ? "An account with that email already exists"
            : "That username is already taken",
        },
        { status: 409 },
      );
    }

    // Username-only: synthetic email + auto-confirm so they can sign in immediately.
    if (!usingEmail) {
      const { data: created, error: createError } =
        await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { username },
        });

      if (createError || !created.user) {
        const msg = createError?.message ?? "Could not create account";
        if (/already|registered|exists/i.test(msg)) {
          return NextResponse.json(
            { error: "That username is already taken" },
            { status: 409 },
          );
        }
        console.error("[auth/signup]", msg);
        return NextResponse.json(
          { error: toUserFacingError(msg) },
          { status: 500 },
        );
      }

      const profileUsername = await ensureProfileForUser({
        userId: created.user.id,
        email,
        preferredUsername: username,
      });

      const anon = getAnonSupabase();
      const { data: sessionData, error: signError } =
        await anon.auth.signInWithPassword({ email, password });

      if (signError || !sessionData.session) {
        return NextResponse.json(
          {
            error:
              "Account created, but sign-in failed. Please try logging in.",
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        needsConfirmation: false,
        user: { id: created.user.id, username: profileUsername },
        session: {
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
        },
      });
    }

    // Email signup — confirmation link when Supabase requires it.
    const anon = getAnonSupabase();
    const emailRedirectTo = authEmailRedirectTo(request);
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

    const profileUsername = await ensureProfileForUser({
      userId: data.user.id,
      email,
      preferredUsername: username,
    });

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

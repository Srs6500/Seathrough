"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export type AuthUser = {
  id: string;
  username: string;
};

export type SignupResult =
  | { ok: true; needsConfirmation: boolean; email?: string }
  | { ok: false; error: string };

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<string | null>;
  signup: (email: string, password: string) => Promise<SignupResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function applySession(session: {
  access_token: string;
  refresh_token: string;
}) {
  const supabase = getBrowserSupabase();
  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        // Keep the current session on transient auth client errors.
        return;
      }
      const token = data.session?.access_token ?? null;

      if (!token) {
        // Only clear when Supabase reports no session (real sign-out / expired).
        setAccessToken(null);
        setUser(null);
        return;
      }

      setAccessToken(token);

      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Do not wipe a working client session on a blip from /api/auth/me —
        // that was aborting in-flight lessons.
        return;
      }
      const body = (await res.json()) as {
        user?: { id: string; username: string } | null;
      };
      if (body.user) setUser(body.user);
    } catch {
      // Network blip — keep whatever session we already have.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await refresh();
      } finally {
        if (alive) setLoading(false);
      }
    })();

    let unsubscribe: (() => void) | undefined;
    try {
      const supabase = getBrowserSupabase();
      const { data } = supabase.auth.onAuthStateChange((event) => {
        // Ignore noisy token refreshes; they were clearing UI mid-lesson.
        if (event === "TOKEN_REFRESHED") return;
        void refresh();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      if (alive) setLoading(false);
    }

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as {
        error?: string;
        user?: AuthUser;
        session?: { access_token: string; refresh_token: string };
      };
      if (!res.ok || !body.session || !body.user) {
        return body.error || "Could not log in";
      }
      await applySession(body.session);
      setUser(body.user);
      setAccessToken(body.session.access_token);
      return null;
    } catch {
      return "Could not log in. Please try again.";
    }
  }, []);

  const signup = useCallback(
    async (email: string, password: string): Promise<SignupResult> => {
      try {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = (await res.json()) as {
          error?: string;
          needsConfirmation?: boolean;
          email?: string;
          user?: AuthUser;
          session?: { access_token: string; refresh_token: string };
        };
        if (!res.ok) {
          return {
            ok: false,
            error: body.error || "Could not create account",
          };
        }

        if (body.needsConfirmation || !body.session || !body.user) {
          return {
            ok: true,
            needsConfirmation: true,
            email: body.email ?? email,
          };
        }

        await applySession(body.session);
        setUser(body.user);
        setAccessToken(body.session.access_token);
        return { ok: true, needsConfirmation: false };
      } catch {
        return {
          ok: false,
          error: "Could not create account. Please try again.",
        };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      const supabase = getBrowserSupabase();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    setUser(null);
    setAccessToken(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      accessToken,
      login,
      signup,
      logout,
      refresh,
    }),
    [user, loading, accessToken, login, signup, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

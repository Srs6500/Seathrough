"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Supabase email confirmation / magic-link landing page.
 * Exchanges `?code=` for a browser session (localStorage), then sends home.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const err =
          url.searchParams.get("error_description") ||
          url.searchParams.get("error");

        if (err) {
          if (!cancelled) setError(err.replace(/\+/g, " "));
          return;
        }

        const supabase = getBrowserSupabase();

        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            if (!cancelled) setError(exchangeError.message);
            return;
          }
        } else {
          // Hash-based tokens (implicit) — detectSessionInUrl handles these.
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) {
            if (!cancelled) setError(sessionError.message);
            return;
          }
          if (!data.session) {
            if (!cancelled) {
              setError("This confirmation link is invalid or has expired.");
            }
            return;
          }
        }

        if (!cancelled) {
          router.replace("/smart-tutor");
        }
      } catch {
        if (!cancelled) {
          setError("Could not finish signing in. Try logging in again.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f4f6] px-4 font-[family-name:var(--font-geist)] text-[#16161a]">
      <div className="w-full max-w-md rounded-2xl border border-[#ececee] bg-white p-8 text-center shadow-sm">
        {error ? (
          <>
            <h1 className="text-[20px] font-semibold tracking-[-0.02em]">
              Link didn&apos;t work
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-[#71717a]">{error}</p>
            <Link
              href="/"
              className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#16161a] px-5 text-[14px] font-medium text-white transition hover:bg-[#2a2a30]"
            >
              Back home
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto size-6 animate-spin text-[#1b6ca8]" />
            <p className="mt-4 text-[14px] text-[#71717a]">
              Confirming your email…
            </p>
          </>
        )}
      </div>
    </main>
  );
}

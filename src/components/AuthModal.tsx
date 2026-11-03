"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { MorphOrb } from "@/components/voice-tutor/MorphOrb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  initialMode?: "login" | "signup";
  /** When true, modal cannot be dismissed without signing in */
  required?: boolean;
  /** Copy for the free daily question limit */
  quotaExhausted?: boolean;
  onSuccess?: () => void;
};

const FIELD =
  "h-10 w-full rounded-lg border border-[#e4e4e7] bg-white px-3 text-[14px] text-[#16161a] outline-none transition placeholder:text-[#a1a1aa] focus:border-[#1b6ca8] focus:ring-2 focus:ring-[#1b6ca8]/15 disabled:opacity-60";

export function AuthModal({
  open,
  onClose,
  initialMode = "login",
  required = false,
  quotaExhausted = false,
  onSuccess,
}: AuthModalProps) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const err =
      mode === "login"
        ? await login(username, password)
        : await signup(username, password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setUsername("");
    setPassword("");
    onSuccess?.();
    onClose();
  }

  const title = quotaExhausted
    ? "You're on a roll"
    : required
      ? "Sign in to continue"
      : mode === "login"
        ? "Welcome back"
        : "Create your account";
  const subtitle = quotaExhausted
    ? "You've used today's 5 free questions. Sign up or log in to keep learning — it's free and takes a few seconds."
    : required
      ? "Create an account or log in to keep learning."
      : "One account for every lesson you start.";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy && !required) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!required}
        className="gap-0 overflow-hidden rounded-2xl border border-[#ececee] bg-white p-0 font-[family-name:var(--font-geist)] text-[#16161a] shadow-[0_24px_64px_rgba(22,22,26,0.16)] ring-0 sm:max-w-[23rem]"
        onPointerDownOutside={(event) => {
          if (required || busy) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          // start typing right away instead of focusing the first tab
          event.preventDefault();
          document.getElementById("auth-username")?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (required || busy) event.preventDefault();
        }}
      >
        {/* header: the tutor's dotted orb on the app's soft grey */}
        <div className="relative flex flex-col items-center bg-[#f4f4f6] px-6 pt-5 pb-4">
          <div className="pointer-events-none -my-3 scale-[0.85]" aria-hidden>
            <MorphOrb state={busy ? "thinking" : "listening"} />
          </div>
          {quotaExhausted ? (
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#3f3f46] shadow-sm">
              <span className="flex gap-0.5" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className="size-1.5 rounded-full bg-[#1b6ca8]" />
                ))}
              </span>
              5 of 5 free questions used
            </span>
          ) : null}
        </div>

        <div className="px-6 pt-5 pb-6">
          <DialogTitle className="text-center text-[19px] font-semibold tracking-[-0.02em]">
            {title}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-1.5 max-w-[19rem] text-center text-[13px] leading-5 text-[#71717a]">
            {subtitle}
          </DialogDescription>

          {/* segmented switch, same feel as the Teach-with chips */}
          <div
            role="tablist"
            aria-label="Account"
            className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-[#f4f4f6] p-1"
          >
            {(
              [
                ["signup", "Sign up"],
                ["login", "Log in"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={cn(
                  "h-8 rounded-md text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#1b6ca8]/40",
                  mode === value
                    ? "bg-white text-[#16161a] shadow-[0_1px_2px_rgba(22,22,26,0.08)]"
                    : "text-[#71717a] hover:text-[#16161a]",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
            <div>
              <label htmlFor="auth-username" className="mb-1.5 block text-[12px] font-medium text-[#3f3f46]">
                Username
              </label>
              <input
                id="auth-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={busy}
                placeholder="e.g. alex"
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1.5 block text-[12px] font-medium text-[#3f3f46]">
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  disabled={busy}
                  placeholder="At least 6 characters"
                  className={cn(FIELD, "pr-10")}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-[#71717a] transition hover:bg-[#f4f4f6] hover:text-[#16161a]"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg border border-[#f3d4d4] bg-[#fdf3f3] px-3 py-2 text-[13px] text-[#c24545]">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy || !username.trim() || !password}
              className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#16161a] text-[14px] font-medium text-white transition hover:bg-[#2a2a2e] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>

          <p className="mt-4 text-center text-[12px] text-[#71717a]">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
              }}
              className="font-medium text-[#1b6ca8] hover:underline"
            >
              {mode === "login" ? "Create an account" : "Log in"}
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { MorphOrb } from "@/components/voice-tutor/MorphOrb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FREE_CONVERSATIONS_PER_FEATURE,
  METERED_FEATURES,
  PRO_MONTHLY_PRICE_USD,
  type MeteredFeature,
} from "@/lib/billing/config";
import { redeemPromoCode, startCheckout } from "@/lib/billing/client";

export type PaywallView =
  | { kind: "limit"; feature: MeteredFeature; resetAt: string | null }
  /** Opened from the account menu to enter a promo code / upgrade. */
  | { kind: "promo" };

type Props = {
  view: PaywallView | null;
  onClose: () => void;
  onOpenAuth: (mode: "login" | "signup") => void;
  /** Promo redeemed or Checkout about to leave — caller refreshes plan state. */
  onUpgraded: () => void;
  /** When false, hide the Upgrade CTA (Stripe env missing). */
  stripeEnabled?: boolean;
};

const FIELD =
  "h-10 min-w-0 flex-1 rounded-lg border border-[#e4e4e7] bg-white px-3 text-[14px] text-[#16161a] outline-none transition placeholder:text-[#a1a1aa] focus:border-[#1b6ca8] focus:ring-2 focus:ring-[#1b6ca8]/15 disabled:opacity-60";

/** Shown when a feature's free conversations run out, or to upgrade / redeem. */
export function PaywallModal({
  view,
  onClose,
  onOpenAuth,
  onUpgraded,
  stripeEnabled = true,
}: Props) {
  const { user, accessToken } = useAuth();
  const signedIn = Boolean(user || accessToken);
  const [busy, setBusy] = useState<"checkout" | "promo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promo, setPromo] = useState("");
  const [showPromo, setShowPromo] = useState(false);
  const [done, setDone] = useState(false);

  /** Every close path resets, so the next open starts clean. */
  function close() {
    setDone(false);
    setError(null);
    setPromo("");
    setShowPromo(false);
    setBusy(null);
    onClose();
  }

  const featureLabel = view?.kind === "limit" ? METERED_FEATURES[view.feature] : null;

  async function upgrade() {
    if (!accessToken) return;
    setBusy("checkout");
    setError(null);
    try {
      const url = await startCheckout(accessToken);
      onUpgraded();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Checkout.");
      setBusy(null);
    }
  }

  async function applyPromo(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken || !promo.trim()) return;
    setBusy("promo");
    setError(null);
    try {
      await redeemPromoCode(accessToken, promo);
      setDone(true);
      setPromo("");
      onUpgraded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That promo code isn't valid.");
    } finally {
      setBusy(null);
    }
  }

  const title = done
    ? "Unlimited access unlocked"
    : view?.kind === "limit"
      ? "You've used your free conversations"
      : "Upgrade to SeeThrough Pro";

  const subtitle = done
    ? "Every feature is now unlimited."
    : view?.kind === "limit"
      ? signedIn
        ? `You've used your ${FREE_CONVERSATIONS_PER_FEATURE} free ${featureLabel} conversations. Upgrade for $${PRO_MONTHLY_PRICE_USD}/mo for unlimited use.`
        : `You've used your ${FREE_CONVERSATIONS_PER_FEATURE} free ${featureLabel} conversations. Sign up to keep learning, then upgrade for unlimited.`
      : `Free accounts get ${FREE_CONVERSATIONS_PER_FEATURE} conversations per feature. Pro is $${PRO_MONTHLY_PRICE_USD}/mo with unlimited use.`;

  return (
    <Dialog
      open={view !== null}
      onOpenChange={(next) => {
        if (!next && !busy) close();
      }}
    >
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-[#ececee] bg-white p-0 font-[family-name:var(--font-geist)] text-[#16161a] shadow-[0_24px_64px_rgba(22,22,26,0.16)] ring-0 sm:max-w-[24rem]">
        <div className="relative flex flex-col items-center bg-[#f4f4f6] px-6 pt-5 pb-4">
          <div className="pointer-events-none -my-3 scale-[0.85]" aria-hidden>
            <MorphOrb state={busy ? "thinking" : "listening"} />
          </div>
          {view?.kind === "limit" && !done ? (
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#3f3f46] shadow-sm">
              <span className="flex gap-0.5" aria-hidden>
                {Array.from({ length: FREE_CONVERSATIONS_PER_FEATURE }, (_, i) => (
                  <i key={i} className="size-1.5 rounded-full bg-[#1b6ca8]" />
                ))}
              </span>
              {FREE_CONVERSATIONS_PER_FEATURE} of {FREE_CONVERSATIONS_PER_FEATURE}{" "}
              {featureLabel} conversations used
            </span>
          ) : null}
        </div>

        <div className="px-6 pt-5 pb-6">
          <DialogTitle className="text-center text-[19px] font-semibold tracking-[-0.02em]">
            {title}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-1.5 max-w-[20rem] text-center text-[13px] leading-5 text-[#71717a]">
            {subtitle}
          </DialogDescription>

          {done ? (
            <button
              type="button"
              onClick={close}
              className="mt-5 h-10 w-full rounded-lg bg-[#16161a] text-[14px] font-medium text-white transition hover:bg-[#2a2a30]"
            >
              Continue
            </button>
          ) : (
            <>
              {signedIn ? (
                <div className="mt-5 space-y-2">
                  {stripeEnabled ? (
                    <button
                      type="button"
                      onClick={() => void upgrade()}
                      disabled={busy !== null}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#16161a] text-[14px] font-medium text-white transition hover:bg-[#2a2a30] disabled:opacity-50"
                    >
                      {busy === "checkout" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CreditCard className="size-3.5" />
                      )}
                      Upgrade — ${PRO_MONTHLY_PRICE_USD}/mo
                    </button>
                  ) : null}

                  {showPromo || !stripeEnabled || view?.kind === "promo" ? (
                    <form className="flex gap-2" onSubmit={(e) => void applyPromo(e)}>
                      <label htmlFor="paywall-promo" className="sr-only">
                        Promo code
                      </label>
                      <input
                        id="paywall-promo"
                        value={promo}
                        onChange={(e) => setPromo(e.target.value)}
                        placeholder="Promo code"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy !== null}
                        className={FIELD}
                      />
                      <button
                        type="submit"
                        disabled={busy !== null || !promo.trim()}
                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[#e4e4e7] bg-white px-4 text-[13px] font-medium text-[#16161a] transition hover:bg-[#fafafa] disabled:opacity-50"
                      >
                        {busy === "promo" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : null}
                        Apply
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowPromo(true)}
                      className="h-9 w-full rounded-lg text-[13px] text-[#71717a] transition hover:text-[#16161a]"
                    >
                      Have a promo code?
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenAuth("signup")}
                    className="h-10 rounded-lg bg-[#16161a] text-[14px] font-medium text-white transition hover:bg-[#2a2a30]"
                  >
                    Sign up
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenAuth("login")}
                    className="h-10 rounded-lg border border-[#e4e4e7] bg-white text-[14px] font-medium text-[#16161a] transition hover:bg-[#fafafa]"
                  >
                    Log in
                  </button>
                </div>
              )}

              {error ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-[#f3d4d4] bg-[#fdf3f3] px-3 py-2 text-[13px] text-[#c24545]"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                onClick={close}
                disabled={busy !== null}
                className="mt-3 h-9 w-full rounded-lg text-[13px] text-[#71717a] transition hover:text-[#16161a]"
              >
                Not now
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

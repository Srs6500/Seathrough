"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/components/AuthProvider";
import { PaywallModal, type PaywallView } from "@/components/usage/PaywallModal";
import type { BillingStatus, MeteredFeature } from "@/lib/billing/config";
import {
  fetchBillingStatus,
  requestConversation,
  startBillingPortal,
} from "@/lib/billing/client";
import {
  canAskAnonymous,
  consumeQuestion,
  DAILY_QUESTION_LIMIT,
  refundQuestion,
  remainingQuestions,
} from "@/lib/usage/dailyQuota";

type AuthMode = "login" | "signup";

type QuestionAccessValue = {
  /** Remaining free questions today (Infinity when signed in). */
  remaining: number;
  dailyLimit: number;
  /** True if this submit may proceed (signed in or free budget left). */
  canAsk: () => boolean;
  /**
   * Call when the user sends a real question.
   * Returns false if blocked — auth modal opens.
   */
  beginQuestion: () => boolean;
  /** Call if the ask was aborted / failed before any real work. */
  cancelQuestion: () => void;
  openAuth: (mode?: AuthMode) => void;
  /**
   * Call when a NEW conversation starts on a metered feature (not on every
   * prompt). Reusing the same conversationId for follow-ups is free.
   * Resolves false when the limit is hit — the paywall opens.
   */
  beginConversation: (feature: MeteredFeature, conversationId: string) => Promise<boolean>;
  /** Plan + per-feature usage; null until loaded. */
  billing: BillingStatus | null;
  refreshBilling: () => Promise<BillingStatus | null>;
  /** Open the upgrade / promo dialog (from a menu, not from a limit). */
  openPromo: () => void;
  /** Open Stripe Customer Portal when the account is on a Stripe plan. */
  openBillingPortal: () => Promise<void>;
};

const QuestionAccessContext = createContext<QuestionAccessValue | null>(null);
const subscribeHydration = () => () => {};

export function QuestionAccessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, accessToken, loading } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [authOpen, setAuthOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [, setTick] = useState(0);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [paywall, setPaywall] = useState<PaywallView | null>(null);
  /** Paywall hidden while the auth modal is up; reshown after it closes. */
  const pendingPaywallRef = useRef<PaywallView | null>(null);
  const loadingRef = useRef(loading);
  const tokenRef = useRef(accessToken);
  useEffect(() => {
    loadingRef.current = loading;
    tokenRef.current = accessToken;
  }, [loading, accessToken]);
  const quotaHydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );

  // Session token means signed-in for quota even while /api/auth/me is still loading.
  const signedIn = Boolean(user || accessToken);

  const remaining = signedIn
    ? Number.POSITIVE_INFINITY
    : quotaHydrated
      ? remainingQuestions()
      : DAILY_QUESTION_LIMIT;

  const refreshBilling = useCallback(async () => {
    const next = await fetchBillingStatus(tokenRef.current);
    if (next) setBilling(next);
    return next;
  }, []);

  useEffect(() => {
    if (loading) return;
    void refreshBilling();
  }, [loading, accessToken, refreshBilling]);

  /** After signing in from the paywall, show it again with the upgrade options. */
  const resumePaywall = useCallback(async () => {
    const pending = pendingPaywallRef.current;
    pendingPaywallRef.current = null;
    if (!pending) return;
    const status = await refreshBilling();
    if (status?.plan === "pro") return;
    setPaywall(pending);
  }, [refreshBilling]);

  const beginConversation = useCallback(
    async (feature: MeteredFeature, conversationId: string) => {
      // Let the sign-in check settle so a signed-in user isn't counted as anonymous.
      for (let i = 0; i < 40 && loadingRef.current; i += 1) {
        await new Promise((r) => window.setTimeout(r, 100));
      }
      const result = await requestConversation(feature, conversationId, tokenRef.current);
      if (result.allowed) return true;
      setPaywall({ kind: "limit", feature: result.feature, resetAt: result.resetAt });
      void refreshBilling();
      return false;
    },
    [refreshBilling],
  );

  const openPromo = useCallback(() => setPaywall({ kind: "promo" }), []);

  const openAuth = useCallback((mode: AuthMode = "login") => {
    setAuthRequired(false);
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);

  const openBillingPortal = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      openAuth("login");
      return;
    }
    try {
      const url = await startBillingPortal(token);
      window.location.assign(url);
    } catch (error) {
      console.warn(
        "[billing/portal]",
        error instanceof Error ? error.message : "portal failed",
      );
      setPaywall({ kind: "promo" });
    }
  }, [openAuth]);

  // Dismiss the free-quota modal once a session is present.
  useEffect(() => {
    if (!signedIn) return;
    setAuthOpen(false);
    setAuthRequired(false);
    void resumePaywall();
  }, [signedIn, resumePaywall]);

  const canAsk = useCallback(() => {
    if (loading) return false;
    if (signedIn) return true;
    return canAskAnonymous();
  }, [loading, signedIn]);

  const beginQuestion = useCallback(() => {
    // Wait for auth hydration — don't burn anonymous quota mid-login.
    if (loading) return false;
    if (signedIn) return true;
    if (!canAskAnonymous()) {
      setAuthMode("signup");
      setAuthRequired(true);
      setAuthOpen(true);
      return false;
    }
    const ok = consumeQuestion();
    setTick((n) => n + 1);
    if (!ok) {
      setAuthMode("signup");
      setAuthRequired(true);
      setAuthOpen(true);
      return false;
    }
    return true;
  }, [loading, signedIn]);

  const cancelQuestion = useCallback(() => {
    if (signedIn) return;
    refundQuestion();
    setTick((n) => n + 1);
  }, [signedIn]);

  const value = useMemo(
    () => ({
      remaining,
      dailyLimit: DAILY_QUESTION_LIMIT,
      canAsk,
      beginQuestion,
      cancelQuestion,
      openAuth,
      beginConversation,
      billing,
      refreshBilling,
      openPromo,
      openBillingPortal,
    }),
    [
      remaining,
      canAsk,
      beginQuestion,
      cancelQuestion,
      openAuth,
      beginConversation,
      billing,
      refreshBilling,
      openPromo,
      openBillingPortal,
    ],
  );

  return (
    <QuestionAccessContext.Provider value={value}>
      {children}
      <AuthModal
        key={`${authMode}-${authOpen ? "open" : "closed"}-${authRequired}`}
        open={authOpen}
        required={authRequired}
        initialMode={authMode}
        quotaExhausted={authRequired}
        onClose={() => {
          setAuthOpen(false);
          setAuthRequired(false);
          void resumePaywall();
        }}
      />
      <PaywallModal
        view={paywall}
        stripeEnabled={billing?.stripeEnabled !== false}
        onClose={() => setPaywall(null)}
        onOpenAuth={(mode) => {
          pendingPaywallRef.current = paywall;
          setPaywall(null);
          openAuth(mode);
        }}
        onUpgraded={() => void refreshBilling()}
      />
    </QuestionAccessContext.Provider>
  );
}

export function useQuestionAccess(): QuestionAccessValue {
  const ctx = useContext(QuestionAccessContext);
  if (!ctx) {
    throw new Error(
      "useQuestionAccess must be used within QuestionAccessProvider",
    );
  }
  return ctx;
}

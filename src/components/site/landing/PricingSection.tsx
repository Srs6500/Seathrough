"use client";

import { Check } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useStudioAccess } from "@/components/site/StudioAccess";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import {
  FREE_CONVERSATIONS_PER_FEATURE,
  PRO_MONTHLY_PRICE_USD,
} from "@/lib/billing/config";
import { startCheckout } from "@/lib/billing/client";
import { SectionIntro, useSeenOnce } from "@/components/site/landing/shared";
import { cn } from "@/lib/utils";

const FREE_PERKS = [
  `${FREE_CONVERSATIONS_PER_FEATURE} conversations per feature`,
  "Smart tutor whiteboard lessons",
  "System design, browser, and vibe coder",
  "No credit card to start",
] as const;

const PRO_PERKS = [
  "Unlimited conversations on every feature",
  "Same whiteboard, voice, and studio tools",
  "Priority when limits would otherwise apply",
  "Cancel anytime from Manage billing",
] as const;

/**
 * Landing pricing: Free (5 conversations) vs Pro ($9/mo unlimited).
 * CTAs open signup / Stripe Checkout / billing portal.
 */
export function PricingSection() {
  const [ref, seen] = useSeenOnce<HTMLElement>(0.25);
  const { user, accessToken } = useAuth();
  const { openAuth, openStudio } = useStudioAccess();
  const { billing, openPromo, openBillingPortal, refreshBilling } =
    useQuestionAccess();
  const signedIn = Boolean(user || accessToken);
  const isPro = billing?.plan === "pro";

  async function onProClick() {
    if (!signedIn || !accessToken) {
      openAuth("signup");
      return;
    }
    if (isPro) {
      if (billing?.planSource === "stripe") {
        await openBillingPortal();
      }
      return;
    }
    if (billing?.stripeEnabled === false) {
      openPromo();
      return;
    }
    try {
      const url = await startCheckout(accessToken);
      void refreshBilling();
      window.location.assign(url);
    } catch {
      openPromo();
    }
  }

  return (
    <section
      id="pricing"
      ref={ref}
      aria-labelledby="pricing-heading"
      className="scroll-mt-16 border-t border-[var(--lp-line)]"
    >
      <div
        className={cn(
          "mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32",
          seen && "lp-drawn",
        )}
      >
        <SectionIntro id="pricing-heading" title="Simple pricing">
          Start free with {FREE_CONVERSATIONS_PER_FEATURE} conversations. When
          you want unlimited lessons, Pro is ${PRO_MONTHLY_PRICE_USD} a month.
        </SectionIntro>

        <div className="mt-12 grid gap-4 md:grid-cols-2 md:gap-5">
          <PriceCard
            name="Free"
            price="$0"
            period="forever"
            blurb={`Create an account and get ${FREE_CONVERSATIONS_PER_FEATURE} conversations on each studio feature.`}
            perks={FREE_PERKS}
            cta={signedIn ? "Open Smart tutor" : "Get started free"}
            onCta={() => {
              if (signedIn) {
                openStudio("/smart-tutor");
                return;
              }
              openAuth("signup");
            }}
            featured={false}
          />
          <PriceCard
            name="Pro"
            price={`$${PRO_MONTHLY_PRICE_USD}`}
            period="/ month"
            blurb="Unlimited conversations across Smart tutor, system design, browser, and vibe coder."
            perks={PRO_PERKS}
            cta={
              isPro
                ? billing?.planSource === "stripe"
                  ? "Manage billing"
                  : "You're on Pro"
                : `Upgrade — $${PRO_MONTHLY_PRICE_USD}/mo`
            }
            onCta={() => void onProClick()}
            featured
            ctaDisabled={isPro && billing?.planSource !== "stripe"}
          />
        </div>
      </div>
    </section>
  );
}

function PriceCard({
  name,
  price,
  period,
  blurb,
  perks,
  cta,
  onCta,
  featured,
  ctaDisabled,
}: {
  name: string;
  price: string;
  period: string;
  blurb: string;
  perks: readonly string[];
  cta: string;
  onCta: () => void;
  featured: boolean;
  ctaDisabled?: boolean;
}) {
  return (
    <article
      className={cn(
        "flex flex-col rounded-2xl border p-6 sm:p-8",
        featured
          ? "border-[var(--lp-ink)] bg-[var(--lp-ink)] text-[var(--lp-paper)]"
          : "border-[var(--lp-line)] bg-[var(--lp-paper)] text-[var(--lp-ink)]",
      )}
    >
      <p
        className={cn(
          "text-[12px] font-semibold tracking-[0.12em] uppercase",
          featured ? "text-white/70" : "text-[var(--lp-muted)]",
        )}
      >
        {name}
      </p>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[2.6rem] leading-none font-medium tracking-[-0.04em]">
          {price}
        </span>
        <span
          className={cn(
            "text-[14px]",
            featured ? "text-white/65" : "text-[var(--lp-muted)]",
          )}
        >
          {period}
        </span>
      </p>
      <p
        className={cn(
          "mt-4 text-[15px] leading-6",
          featured ? "text-white/80" : "text-[var(--lp-soft)]",
        )}
      >
        {blurb}
      </p>
      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {perks.map((perk) => (
          <li key={perk} className="flex items-start gap-2.5 text-[14px] leading-5">
            <Check
              className={cn(
                "mt-0.5 size-4 shrink-0",
                featured ? "text-white" : "text-[var(--lp-pen)]",
              )}
              strokeWidth={2.25}
              aria-hidden
            />
            <span className={featured ? "text-white/90" : "text-[var(--lp-soft)]"}>
              {perk}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onCta}
        disabled={ctaDisabled}
        className={cn(
          "mt-8 inline-flex h-11 items-center justify-center rounded-lg text-[14px] font-medium transition disabled:cursor-default disabled:opacity-70",
          featured
            ? "bg-white text-[#16161a] hover:bg-[#f4f4f6]"
            : "bg-[var(--lp-ink)] text-[var(--lp-paper)] hover:opacity-90",
        )}
      >
        {cta}
      </button>
    </article>
  );
}

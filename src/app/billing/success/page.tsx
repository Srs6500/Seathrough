"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";

/** Post-Checkout landing — refresh plan, then send them back into the tutor. */
export default function BillingSuccessPage() {
  const { refreshBilling } = useQuestionAccess();

  useEffect(() => {
    void refreshBilling();
  }, [refreshBilling]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f4f6] px-4 font-[family-name:var(--font-geist)] text-[#16161a]">
      <div className="w-full max-w-md rounded-2xl border border-[#ececee] bg-white p-8 text-center shadow-sm">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#1b6ca8] uppercase">
          SeeThrough Pro
        </p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.02em]">
          You&apos;re unlimited
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[#71717a]">
          Your $9/mo plan is active. Smart tutor, browser, and the rest of the
          studio no longer count against the free limit.
        </p>
        <Link
          href="/smart-tutor"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[#16161a] px-5 text-[14px] font-medium text-white transition hover:bg-[#2a2a30]"
        >
          Back to Smart tutor
        </Link>
      </div>
    </main>
  );
}

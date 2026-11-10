import Link from "next/link";

/** Checkout abandoned — soft landing, no plan change. */
export default function BillingCancelPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f4f6] px-4 font-[family-name:var(--font-geist)] text-[#16161a]">
      <div className="w-full max-w-md rounded-2xl border border-[#ececee] bg-white p-8 text-center shadow-sm">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
          Checkout canceled
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[#71717a]">
          No charge was made. You can keep using your free conversations, or
          upgrade anytime from the paywall.
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

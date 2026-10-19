"use client";

import { useState } from "react";

/**
 * Deliberately broken demo app for Frontend Health Scanner MVP.
 * Source attributes (`data-st-source`) stand in for source-map mapping.
 */
export default function FrontendHealthDemoPage() {
  const [status, setStatus] = useState("");

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <header className="flex items-center gap-5 border-b border-[#e2e8f0] bg-white px-5 py-4">
        <div className="font-bold">Acme Studio</div>
        <nav className="text-sm text-[#334155]">
          <a className="mr-3" href="/">
            Home
          </a>
          <a className="mr-3" href="/about">
            About
          </a>
          <a
            id="broken-nav"
            href="/this-page-does-not-exist"
            data-st-source="src/components/SiteNav.tsx:18"
            data-st-component="SiteNav"
          >
            Contact
          </a>
        </nav>
      </header>

      <main className="mx-auto max-w-[720px] px-5 py-6 pb-12">
        <h1 className="mb-2 text-3xl font-semibold">
          Build something remarkable.
        </h1>
        <p className="text-[#475569]">
          A sample page shown in SeeThrough&apos;s visual scanner.
        </p>

        <div
          id="mobile-menu"
          className="mt-4 flex w-[520px] gap-2 whitespace-nowrap py-2"
          data-st-source="src/components/MobileMenu.tsx:12"
          data-st-component="MobileMenu"
        >
          {[
            "Overview",
            "Features",
            "Pricing",
            "Docs",
            "Blog",
            "Careers",
            "Support",
          ].map((item) => (
            <span
              key={item}
              className="rounded-full bg-[#e2e8f0] px-3 py-1 text-xs"
            >
              {item}
            </span>
          ))}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element -- intentional a11y demo */}
        <img
          id="hero-image"
          className="my-6 block h-[180px] w-full rounded-xl bg-[#cbd5e1] object-cover"
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='180'%3E%3Crect fill='%2394a3b8' width='800' height='180'/%3E%3Ctext x='40' y='100' fill='white' font-size='28'%3EHero image%3C/text%3E%3C/svg%3E"
          data-st-source="src/components/Hero.tsx:24"
          data-st-component="Hero"
        />

        <form
          id="contact-form"
          className="grid gap-3 rounded-xl border border-[#e2e8f0] bg-white p-4"
          data-st-source="src/components/ContactForm.tsx:10"
          data-st-component="ContactForm"
          onSubmit={(e) => e.preventDefault()}
        >
          <div>
            <label htmlFor="email" className="text-sm font-semibold">
              Your email
            </label>
            <input
              id="email"
              name="email"
              type="text"
              placeholder="you@company.com"
              className="mt-1 h-10 w-full rounded-lg border border-[#cbd5e1] px-3"
            />
          </div>
          <button
            id="submit-btn"
            type="button"
            data-st-source="src/components/ContactForm.tsx:42"
            data-st-component="ContactForm"
            className="h-10 rounded-lg bg-[#17324a] font-semibold text-white"
            onClick={() => {
              setStatus("Sending…");
              // Deliberate crash — undefined API client.
              const api = (window as unknown as { __missingContactApi?: { send: () => void } })
                .__missingContactApi;
              api!.send();
            }}
          >
            Submit
          </button>
          <div id="status" className="min-h-5 text-sm text-[#64748b]">
            {status}
          </div>
        </form>
      </main>
    </div>
  );
}

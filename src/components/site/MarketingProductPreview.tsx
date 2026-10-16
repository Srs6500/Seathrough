"use client";

/** Light-theme product window for the dark landing hero (Asset-style contrast). */
export function MarketingProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <div
        className="pointer-events-none absolute -inset-x-10 -bottom-16 h-40 rounded-[100%] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.14),transparent_70%)] blur-2xl"
        aria-hidden
      />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#f4f5f7] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.85)] ring-1 ring-white/5">
        <div className="flex items-center gap-2 border-b border-[#e5e7eb] bg-white px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-2 text-[12px] font-medium text-[#111827]">
            SeeThrough · Bug Analyzer
          </span>
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            Indexed
          </span>
        </div>

        <div className="grid min-h-[22rem] md:min-h-[28rem] md:grid-cols-[13rem_minmax(0,1fr)_14rem]">
          <aside className="hidden border-r border-[#e5e7eb] bg-white p-3 md:block">
            <p className="px-1 text-[10px] font-semibold tracking-wide text-[#9ca3af] uppercase">
              Features
            </p>
            <ul className="mt-2 space-y-1">
              {[
                { name: "Authentication", bad: true },
                { name: "Dashboard", bad: true },
                { name: "Billing", bad: false },
                { name: "Profile", bad: false },
              ].map((item) => (
                <li key={item.name}>
                  <div
                    className={
                      item.bad
                        ? "rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] font-medium text-red-800"
                        : "rounded-lg px-2.5 py-2 text-[12px] font-medium text-[#374151]"
                    }
                  >
                    {item.name}
                    {item.bad ? (
                      <span className="mt-0.5 block text-[10px] font-normal text-red-600">
                        2 issues
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          <div className="bg-[#fafafa] p-4 sm:p-5">
            <p className="text-[11px] font-semibold text-[#6b7280]">
              Authentication flow
            </p>
            <ol className="mt-4 flex flex-col items-center gap-0">
              {[
                { label: "Login Page", kind: "Page", bad: true },
                { label: "LoginForm", kind: "Component", bad: true },
                { label: "loginUser()", kind: "Function", bad: true },
                { label: "Authentication Service", kind: "Service", bad: true },
              ].map((node, i, arr) => (
                <li key={node.label} className="flex w-full max-w-xs flex-col items-center">
                  <div
                    className={
                      node.bad
                        ? "w-full rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-center"
                        : "w-full rounded-xl border border-[#e5e7eb] bg-white px-4 py-3 text-center"
                    }
                  >
                    <p
                      className={
                        node.bad
                          ? "text-[13px] font-semibold text-red-900"
                          : "text-[13px] font-semibold text-[#111827]"
                      }
                    >
                      {node.label}
                    </p>
                    <p className="text-[11px] text-[#6b7280]">{node.kind}</p>
                  </div>
                  {i < arr.length - 1 ? (
                    <div className="py-1 text-red-300" aria-hidden>
                      ↓
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>

          <aside className="hidden border-l border-[#e5e7eb] bg-white p-3 md:block">
            <p className="px-1 text-[10px] font-semibold tracking-wide text-[#9ca3af] uppercase">
              Issues found
            </p>
            <ul className="mt-2 space-y-2">
              {[
                {
                  title: "Login accepts any credentials",
                  sev: "Critical",
                },
                {
                  title: "Sign up does not create a user",
                  sev: "Critical",
                },
                {
                  title: "No database found",
                  sev: "High",
                },
              ].map((issue) => (
                <li
                  key={issue.title}
                  className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-2.5 py-2"
                >
                  <span
                    className={
                      issue.sev === "Critical"
                        ? "rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-700"
                        : "rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-semibold text-orange-700"
                    }
                  >
                    {issue.sev}
                  </span>
                  <p className="mt-1 text-[11px] leading-snug font-medium text-[#111827]">
                    {issue.title}
                  </p>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}

"use client";

type ChainItem = {
  key: string;
  name: string;
  file: string | null;
  line: number | null;
  problem?: { message: string } | null;
};

type Props = {
  chain: ChainItem[];
  leaf: ChainItem | null;
  codePath: string | null;
  code: string | null;
  highlightLine: number | null;
  loading?: boolean;
  error?: string | null;
};

export function InspectCodePanel({
  chain,
  leaf,
  codePath,
  code,
  highlightLine,
  loading,
  error,
}: Props) {
  const lines = code?.split("\n") ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-[#e5eef4] bg-white lg:border-l lg:border-t-0">
      <div className="border-b border-[#e5eef4] px-3 py-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[#7a93a8]">
          Inspect
        </p>
        <p className="mt-0.5 text-sm font-semibold text-[#17324a]">
          {leaf?.name ?? "Hover UI → Inspect"}
        </p>
      </div>

      {chain.length > 0 ? (
        <div className="border-b border-[#e5eef4] px-3 py-2">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[#7a93a8]">
            Connected components
          </p>
          <ol className="space-y-1">
            {[...chain].reverse().map((item, index, arr) => {
              const isLeaf = item.key === leaf?.key;
              const bad = Boolean(item.problem) || isLeaf;
              return (
                <li
                  key={item.key}
                  className={
                    bad
                      ? "rounded-md bg-red-50 px-2 py-1 text-xs text-red-800"
                      : "rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800"
                  }
                >
                  <span className="font-medium">{item.name}</span>
                  {item.file ? (
                    <span className="mt-0.5 block truncate font-mono text-[10px] opacity-80">
                      {item.file.split("/").slice(-3).join("/")}
                      {item.line != null ? `:${item.line}` : ""}
                    </span>
                  ) : null}
                  {isLeaf ? (
                    <span className="mt-0.5 block text-[10px] font-medium">
                      ← bug shown below
                    </span>
                  ) : null}
                  {index < arr.length - 1 ? (
                    <span className="sr-only">then</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-3 text-sm text-[#5a7388]">Loading source…</p>
        ) : error ? (
          <p className="p-3 text-sm text-red-700">{error}</p>
        ) : code && codePath ? (
          <>
            <div className="border-b border-[#e5eef4] px-3 py-1.5 font-mono text-[10px] text-[#7a93a8]">
              {codePath}
              {highlightLine != null ? `:${highlightLine}` : ""}
            </div>
            <pre className="overflow-x-auto bg-[#0f1c27] p-0 font-mono text-[11px] leading-5 text-[#e8eef3]">
              {lines.map((line, i) => {
                const n = i + 1;
                const active =
                  highlightLine != null &&
                  Math.abs(n - highlightLine) <= 0;
                const near =
                  highlightLine != null &&
                  Math.abs(n - highlightLine) <= 2 &&
                  !active;
                return (
                  <div
                    key={`${n}:${line.slice(0, 12)}`}
                    className={
                      active
                        ? "flex bg-red-500/30"
                        : near
                          ? "flex bg-red-500/10"
                          : "flex"
                    }
                  >
                    <span className="w-10 shrink-0 select-none pr-2 text-right text-[#64748b]">
                      {n}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all pr-3">
                      {line || " "}
                    </span>
                  </div>
                );
              })}
            </pre>
          </>
        ) : (
          <div className="space-y-2 p-3 text-sm text-[#5a7388]">
            <p>
              <span className="font-medium text-emerald-700">Green</span> on
              hover = that component looks fine.{" "}
              <span className="font-medium text-red-700">Red</span> = tied to a
              real runtime error (or your last Inspect chain).
            </p>
            <p>
              Hover → click <span className="font-medium text-[#17324a]">Inspect</span>{" "}
              or the <span className="font-medium text-[#17324a]">⇧</span> badge,
              or hold <span className="font-medium text-[#17324a]">Shift</span> and
              click the UI.
            </p>
            <p>
              We detect uncaught crashes, failed <code className="font-mono text-[11px]">fetch</code>{" "}
              calls, and on-screen error banners (e.g. “Something went wrong”).
              Submit again after <span className="font-medium text-[#17324a]">Restart</span>, then
              Inspect the red UI for the component chain + source.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

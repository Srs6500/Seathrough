"use client";

import { buildOverviewStory } from "@/lib/schema-guide/overviewStory";
import type { SchemaGuide } from "@/lib/schema-guide/types";

export function SchemaOverview({
  guide,
  onOpenTable,
  onAsk,
}: {
  guide: SchemaGuide;
  onOpenTable: (tableId: string) => void;
  onAsk: (question: string) => void;
}) {
  const story = buildOverviewStory(guide);

  return (
    <div className="mx-auto w-full max-w-[680px] px-8 py-10">
      <h1 className="text-[28px] font-medium leading-tight tracking-[-0.03em] text-[#16161a]">
        {story.headline}
      </h1>
      <p className="mt-3 text-[16px] leading-relaxed text-[#3f3f46]">{story.how}</p>
      <p className="mt-2 text-[14px] text-[#71717a]">{story.engine}</p>

      <ul className="mt-8 grid grid-cols-3 gap-3">
        {story.heroes.map((item) => (
          <li
            key={item.label}
            className="rounded-2xl border border-[#ececee] bg-white px-4 py-3"
          >
            <p className="text-[20px] font-medium tracking-[-0.03em] text-[#16161a]">
              {item.value}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-[#71717a]">{item.label}</p>
          </li>
        ))}
      </ul>

      {story.connections.length ? (
        <section className="mt-10">
          <h2 className="text-[15px] font-medium text-[#16161a]">How they connect</h2>
          <ol className="mt-3 space-y-2">
            {story.connections.map((line) => (
              <li
                key={line}
                className="rounded-xl border border-[#ececee] bg-white px-4 py-3 text-[14px] text-[#16161a]"
              >
                {line}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="text-[15px] font-medium text-[#16161a]">The main pieces</h2>
        <ul className="mt-3 space-y-4">
          {story.groups.map((group) => (
            <li key={group.id}>
              <p className="text-[14px] font-medium text-[#16161a]">{group.label}</p>
              <p className="mt-0.5 text-[13px] text-[#71717a]">{group.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.tableIds.map((id) => {
                  const table = guide.tables.find((item) => item.id === id);
                  if (!table) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onOpenTable(id)}
                      className="rounded-full border border-[#e6e6ea] bg-white px-3 py-1.5 text-[13px] text-[#16161a] hover:border-[#6d5efc]"
                    >
                      {table.tableName}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {guide.actions.length ? (
        <section className="mt-10">
          <h2 className="text-[15px] font-medium text-[#16161a]">Ask a real question</h2>
          <p className="mt-1 text-[13px] text-[#71717a]">
            These walk the tables and the code that writes them.
          </p>
          <ul className="mt-3 space-y-2">
            {guide.actions.slice(0, 3).map((action) => (
              <li key={action.id}>
                <button
                  type="button"
                  onClick={() => onAsk(action.question)}
                  className="w-full rounded-xl border border-[#ececee] bg-white px-4 py-3 text-left text-[14px] text-[#16161a] hover:border-[#6d5efc]"
                >
                  {action.question}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

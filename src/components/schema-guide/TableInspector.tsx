"use client";

import { X } from "lucide-react";
import { buildExploreStory } from "@/lib/schema-guide/overviewStory";
import type { SchemaGuide, TableGuide } from "@/lib/schema-guide/types";

export function TableInspector({
  guide,
  table,
  onClose,
}: {
  guide: SchemaGuide;
  table: TableGuide;
  onClose: () => void;
}) {
  const story = buildExploreStory(guide, table.id);
  const stored = table.importantFields.filter(
    (field) =>
      !/^id$/i.test(field.name) &&
      !/identifies the related|unique id/i.test(field.note),
  );
  const writes = table.usages.filter((use) =>
    ["create", "update", "delete", "upsert"].includes(use.operation),
  );
  const uses = (writes.length ? writes : table.usages).slice(0, 4);

  return (
    <aside className="schema-inspector">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[#71717a]">{story.kicker}</p>
          <h2 className="mt-0.5 text-[18px] font-medium leading-snug tracking-[-0.02em] break-words text-[#16161a]">
            {story.headline}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed break-words text-[#71717a]">
            {story.blurb}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-[#71717a] hover:bg-[#f4f4f6]"
          aria-label="Close details"
        >
          <X className="size-4" />
        </button>
      </header>

      <ul className="mt-5 grid gap-2">
        {story.heroes.map((item) => (
          <li
            key={item.label}
            className="flex items-baseline justify-between gap-3 rounded-xl border border-[#ececee] bg-[#fafafa] px-3 py-2"
          >
            <p className="min-w-0 text-[12px] leading-snug break-words text-[#71717a]">
              {item.label}
            </p>
            <p className="shrink-0 text-[16px] font-medium tracking-[-0.02em] text-[#16161a]">
              {item.value}
            </p>
          </li>
        ))}
      </ul>

      {story.connections.length ? (
        <section className="mt-5">
          <h3 className="text-[12px] text-[#71717a]">How it connects</h3>
          <ul className="mt-2 space-y-2">
            {story.connections.map((line) => (
              <li
                key={line}
                className="rounded-xl border border-[#ececee] px-3 py-2 text-[13px] leading-relaxed break-words text-[#16161a]"
              >
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <dl className="mt-5 grid gap-5">
        <Row label="What it remembers">
          {stored.length === 0 ? (
            <p className="text-[#71717a]">Just the usual identity for this record.</p>
          ) : (
            <ul className="space-y-1.5">
              {stored.map((field) => (
                <li key={field.name}>{field.note}</li>
              ))}
            </ul>
          )}
        </Row>

        <Row label="Where the app uses this">
          {uses.length === 0 ? (
            <p className="text-[#71717a]">
              We did not find code that reads or writes this yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {uses.map((use) => (
                <li key={`${use.file}:${use.line}:${use.callee}`}>
                  <p className="text-[#16161a]">
                    {useVerb(use.operation)}
                    {use.functionName ? ` in ${use.functionName}()` : ""}.
                  </p>
                  <p className="text-[12px] text-[#71717a]">{use.file}</p>
                </li>
              ))}
            </ul>
          )}
        </Row>

        {table.sampleRows.length ? (
          <Row label="What a row looks like">
            <p className="mb-2 text-[12px] text-[#71717a]">
              Made-up examples — not from a live database.
            </p>
            <div className="overflow-x-auto rounded-lg border border-[#ececee]">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[#fafafa] text-[#71717a]">
                  <tr>
                    {Object.keys(table.sampleRows[0]?.values ?? {}).map((key) => (
                      <th key={key} className="px-2 py-1.5 font-medium">
                        {humanField(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.sampleRows.map((row, index) => (
                    <tr key={index} className="border-t border-[#f0f0f3]">
                      {Object.values(row.values).map((value, cell) => (
                        <td key={cell} className="px-2 py-1.5 text-[#16161a]">
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Row>
        ) : null}
      </dl>
    </aside>
  );
}

function humanField(name: string): string {
  return (
    name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/id$/i, "")
      .trim()
      .toLowerCase() || name
  );
}

function useVerb(operation: string): string {
  if (operation === "create") return "Adds a new record";
  if (operation === "update" || operation === "upsert") return "Updates a record";
  if (operation === "delete") return "Removes a record";
  if (operation === "count") return "Counts these records";
  return "Reads these records";
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[12px] text-[#71717a]">{label}</dt>
      <dd className="mt-1 space-y-2 text-[13px] leading-relaxed text-[#16161a]">
        {children}
      </dd>
    </div>
  );
}

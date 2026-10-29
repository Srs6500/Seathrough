"use client";

import type { KnowledgeGraph } from "@/lib/schema-guide/types";

export function AskGraph({
  graph,
  onOpenTable,
}: {
  graph: KnowledgeGraph;
  onOpenTable: (tableId: string) => void;
}) {
  if (!graph.nodes.length) return null;
  const lists = graph.nodes.filter((node) => node.kind === "list");
  const others = graph.nodes.filter((node) => node.kind !== "list");
  const links = graph.edges.filter((edge) => edge.kind !== "part-of");

  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-medium text-[#16161a]">How this fits together</h2>
      <p className="mt-1 text-[13px] text-[#71717a]">
        Only the connected pieces that answer your question — not every list.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {graph.nodes.map((node) => (
          <li key={node.id}>
            {node.tableId ? (
              <button
                type="button"
                onClick={() => onOpenTable(node.tableId!)}
                className={`rounded-full px-3 py-1.5 text-[13px] ${
                  node.kind === "setting" || node.kind === "secret"
                    ? "border border-[#f0ddd4] bg-[#fff7f3] text-[#9c4a2a]"
                    : "bg-[#f4f1ff] text-[#5b4fd4]"
                }`}
              >
                {node.label}
              </button>
            ) : (
              <span className="rounded-full bg-[#f4f4f6] px-3 py-1.5 text-[13px] text-[#71717a]">
                {node.label}
              </span>
            )}
          </li>
        ))}
      </ul>
      {links.length ? (
        <ul className="mt-3 space-y-2">
          {links.slice(0, 5).map((edge) => {
            const from = graph.nodes.find((node) => node.id === edge.from);
            const to = graph.nodes.find((node) => node.id === edge.to);
            if (!from || !to) return null;
            return (
              <li
                key={edge.id}
                className="rounded-xl border border-[#ececee] bg-white px-3 py-2 text-[13px] text-[#16161a]"
              >
                <span className="font-medium">{from.label}</span>
                <span className="text-[#71717a]"> — {edge.label} — </span>
                <span className="font-medium">{to.label}</span>
              </li>
            );
          })}
        </ul>
      ) : lists.length && !others.length ? (
        <p className="mt-3 text-[13px] text-[#71717a]">
          This slice is just {lists.map((node) => node.label.toLowerCase()).join(" and ")}.
          No password, lock, or permission link is attached.
        </p>
      ) : null}
    </section>
  );
}

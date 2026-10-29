"use client";

import { useMemo, useState } from "react";
import { BackendExplainer } from "@/components/schema-guide/BackendExplainer";
import { FrontendInspect } from "@/components/schema-guide/FrontendInspect";
import { SchemaAsk } from "@/components/schema-guide/SchemaAsk";
import { SchemaExplore } from "@/components/schema-guide/SchemaExplore";
import { SchemaOverview } from "@/components/schema-guide/SchemaOverview";
import { SchemaSource } from "@/components/schema-guide/SchemaSource";
import { TableInspector } from "@/components/schema-guide/TableInspector";
import { guideBackend } from "@/lib/schema-guide/backendStory";
import { askSchema } from "@/lib/schema-guide/client";
import type { SchemaAskResult, SchemaGuide } from "@/lib/schema-guide/types";

type Section = "database" | "backend" | "frontend";

type View = "overview" | "schema" | "explore" | "ask";

const TABS: Array<{ id: View; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "schema", label: "Schema" },
  { id: "explore", label: "Explore" },
  { id: "ask", label: "Ask" },
];

export function VibeDatabaseDashboard({
  repoName,
  guide,
}: {
  repoName: string;
  guide: SchemaGuide;
}) {
  const [section, setSection] = useState<Section>("database");
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(
    guide.tables[0]?.id ?? null,
  );
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [focusNearby, setFocusNearby] = useState(true);
  const [tableQuery, setTableQuery] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<SchemaAskResult | null>(null);
  const [askQuestion, setAskQuestion] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const tables = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    if (!q) return guide.tables;
    return guide.tables.filter((table) =>
      `${table.modelName} ${table.tableName} ${table.purpose}`
        .toLowerCase()
        .includes(q),
    );
  }, [guide.tables, tableQuery]);

  const selected = guide.tables.find((table) => table.id === selectedId) ?? null;
  const backend = guideBackend(guide);

  async function runAsk(question: string) {
    setAskBusy(true);
    setAskError(null);
    setAskQuestion(question);
    setAskResult(null);
    setView("ask");
    try {
      const result = await askSchema(question, guide);
      setAskResult(result);
      setHighlighted(result.tableIds);
      if (result.tableIds[0]) setSelectedId(result.tableIds[0]);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Could not answer that.");
    } finally {
      setAskBusy(false);
    }
  }

  function openTable(tableId: string) {
    setSelectedId(tableId);
    setHighlighted([tableId]);
    setFocusNearby(true);
    setDetailOpen(true);
    setSection("database");
    setView("explore");
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex h-full w-[200px] shrink-0 flex-col overflow-hidden border-r border-[#ececee] bg-white">
        <div className="border-b border-[#f0f0f3] px-4 py-3">
          <p className="text-[11px] text-[#71717a]">Explain</p>
          <p className="truncate text-[15px] text-[#16161a]">{repoName}</p>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          <button
            type="button"
            onClick={() => setSection("database")}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] ${
              section === "database"
                ? "bg-[#f4f1ff] text-[#5b4fd4]"
                : "text-[#16161a] hover:bg-[#fafafa]"
            }`}
          >
            Database
            <span className="text-[11px]">{guide.tables.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setSection("backend")}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] ${
              section === "backend"
                ? "bg-[#f4f1ff] text-[#5b4fd4]"
                : "text-[#16161a] hover:bg-[#fafafa]"
            }`}
          >
            Backend
            <span className="text-[11px]">{backend.features.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setSection("frontend")}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] ${
              section === "frontend"
                ? "bg-[#f4f1ff] text-[#5b4fd4]"
                : "text-[#16161a] hover:bg-[#fafafa]"
            }`}
          >
            Frontend
          </button>
        </nav>
      </aside>

      <div
        hidden={section !== "frontend"}
        className={
          section === "frontend"
            ? "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            : "hidden"
        }
      >
        <FrontendInspect repoName={repoName} />
      </div>
      {section === "backend" ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <BackendExplainer
            guide={guide}
            onOpenTable={openTable}
          />
        </div>
      ) : section === "database" ? (
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside className="flex h-full w-[220px] shrink-0 flex-col overflow-hidden border-r border-[#ececee] bg-[#fafafa]">
          <div className="border-b border-[#f0f0f3] px-4 py-3">
            <p className="text-[11px] text-[#71717a]">Tables</p>
            <p className="text-[13px] text-[#16161a]">
              {guide.tables.length} in this schema
            </p>
          </div>
          <div className="px-3 pt-3">
            <input
              value={tableQuery}
              onChange={(event) => setTableQuery(event.target.value)}
              placeholder="Find a table"
              className="h-9 w-full rounded-lg border border-[#ececee] bg-white px-2.5 text-[13px] outline-none focus:border-[#6d5efc]"
            />
          </div>
          <ul className="flex-1 overflow-y-auto px-2 py-2">
            {tables.length === 0 ? (
              <li className="px-2 py-4 text-center text-[12px] text-[#8a8a93]">
                No tables matched that search.
              </li>
            ) : (
              tables.map((table) => (
                <li key={table.id}>
                  <button
                    type="button"
                    onClick={() => openTable(table.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] ${
                      selectedId === table.id
                        ? "bg-[#f4f1ff] text-[#5b4fd4]"
                        : "text-[#16161a] hover:bg-white"
                    }`}
                  >
                    <span className="truncate">{table.tableName}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-[#a1a1aa]">
                      {table.fields.filter((field) => !field.isRelation).length}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#ececee] bg-white px-4">
            <nav className="flex items-center gap-1 rounded-full bg-[#f4f4f6] p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setView(tab.id);
                    if (tab.id === "explore") {
                      setFocusNearby(true);
                      setDetailOpen(true);
                    }
                  }}
                  className={`rounded-full px-3 py-1 text-[13px] ${
                    view === tab.id
                      ? "bg-white text-[#16161a] shadow-sm"
                      : "text-[#71717a]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <p className="text-[12px] text-[#71717a]">
              {guide.relations.length === 1
                ? "1 link"
                : `${guide.relations.length} links`}
            </p>
          </div>
          <div
            className={
              view === "explore" || view === "ask"
                ? "min-h-0 flex-1 overflow-hidden"
                : "min-h-0 flex-1 overflow-y-auto"
            }
          >
            {view === "overview" ? (
              <SchemaOverview
                guide={guide}
                onOpenTable={openTable}
                onAsk={(question) => void runAsk(question)}
              />
            ) : null}
            {view === "schema" ? (
              <SchemaSource guide={guide} onOpenTable={openTable} />
            ) : null}
            {view === "explore" ? (
              <SchemaExplore
                guide={guide}
                selectedId={selectedId}
                highlighted={highlighted}
                focusNearby={focusNearby}
                onSelect={openTable}
                onToggleFocus={() => setFocusNearby((value) => !value)}
                onOpenPanel={() => setDetailOpen(true)}
                panel={
                  selected && detailOpen ? (
                    <TableInspector
                      guide={guide}
                      table={selected}
                      onClose={() => setDetailOpen(false)}
                    />
                  ) : null
                }
              />
            ) : null}
            {view === "ask" ? (
              <SchemaAsk
                guide={guide}
                asked={askQuestion}
                result={askResult}
                busy={askBusy}
                error={askError}
                onAsk={(question) => void runAsk(question)}
                onOpenTable={openTable}
              />
            ) : null}
          </div>
        </div>
      </div>
      ) : null}
    </div>
  );
}

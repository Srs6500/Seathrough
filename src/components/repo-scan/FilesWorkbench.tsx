"use client";

import { useMemo } from "react";
import { Alert, Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { legacyCreateColumnHelper } from "@tanstack/react-table/legacy";
import { FileCodeViewer } from "@/components/repo-scan/FileCodeViewer";
import { ScanDataTable } from "@/components/repo-scan/ScanDataTable";
import type { TreeSitterFile, TreeSitterParseResult } from "@/lib/repo-scan/types";

const columnHelper = legacyCreateColumnHelper<TreeSitterFile>();

const columns = [
  columnHelper.accessor("path", {
    header: "Path",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("language", {
    header: "Lang",
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("nodeCount", { header: "Nodes" }),
  columnHelper.accessor("errorCount", { header: "Errors" }),
  columnHelper.display({
    id: "status",
    header: "Status",
    cell: (info) =>
      info.row.original.skipped
        ? "skipped"
        : info.row.original.hasError
          ? "recovery"
          : "ok",
  }),
];

export function FilesWorkbench({
  parse,
  activePath,
  onSelectPath,
}: {
  parse: TreeSitterParseResult;
  activePath: string | null;
  onSelectPath: (path: string) => void;
}) {
  const active = useMemo(
    () => parse.files.find((file) => file.path === activePath) ?? null,
    [parse.files, activePath],
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
      <Paper
        withBorder
        radius={0}
        p="sm"
        className="min-h-0 overflow-y-auto"
        style={{ borderLeft: 0, borderTop: 0, borderBottom: 0 }}
      >
        <Title order={4} mb="xs">
          Files
        </Title>
        <ScanDataTable
          data={parse.files}
          columns={columns}
          pageSize={12}
          searchPlaceholder="Filter files…"
          getRowId={(row) => row.path}
          selectedId={activePath}
          onRowClick={(row) => onSelectPath(row.path)}
        />
      </Paper>
      <Stack gap="sm" p="md" className="min-h-0">
        {parse.truncated ? (
          <Alert color="yellow">File list was capped, so this parse is partial.</Alert>
        ) : null}
        {active ? (
          <>
            <div>
              <Title order={4} lineClamp={1}>
                {active.path}
              </Title>
              <Group gap="xs" mt={4}>
                <Text size="sm" c="dimmed">
                  {[
                    active.language,
                    active.rootType,
                    `${active.nodeCount} nodes`,
                    active.hasError ? "has recovery" : "clean parse",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {active.skipped ? <Badge color="gray">skipped</Badge> : null}
              </Group>
            </div>
            {active.symbols.length > 0 ? (
              <Text size="xs" c="dimmed">
                Symbols:{" "}
                {active.symbols
                  .slice(0, 12)
                  .map((symbol) => `${symbol.kind} ${symbol.name}`)
                  .join(", ")}
                {active.symbols.length > 12
                  ? ` · +${active.symbols.length - 12}`
                  : ""}
              </Text>
            ) : null}
            <Paper withBorder flex={1} style={{ minHeight: 360, overflow: "hidden" }}>
              <FileCodeViewer file={active} />
            </Paper>
          </>
        ) : (
          <Text c="dimmed" size="sm">
            Pick a file to open it in Monaco.
          </Text>
        )}
      </Stack>
    </div>
  );
}

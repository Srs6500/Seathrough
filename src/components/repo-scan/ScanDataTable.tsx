"use client";

import { useMemo, useState } from "react";
import { Group, Pagination, Table, Text, TextInput } from "@mantine/core";
import { type SortingState } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyTableOptions,
} from "@tanstack/react-table/legacy";

export function ScanDataTable<T extends object>({
  data,
  columns,
  searchPlaceholder = "Filter rows…",
  pageSize = 10,
  onRowClick,
  getRowId,
  selectedId,
  searchable = true,
}: {
  data: T[];
  columns: LegacyTableOptions<T>["columns"] | readonly unknown[];
  searchPlaceholder?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T) => string;
  selectedId?: string | null;
  searchable?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const memoColumns = useMemo(() => columns, [columns]);

  const table = useLegacyTable({
    data,
    columns: memoColumns as LegacyTableOptions<T>["columns"],
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize } },
    getRowId: getRowId
      ? (row) => getRowId(row)
      : undefined,
  });

  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div>
      {searchable ? (
        <TextInput
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.currentTarget.value)}
          placeholder={searchPlaceholder}
          mb="sm"
        />
      ) : null}
      <Table.ScrollContainer minWidth={480}>
        <Table highlightOnHover striped stickyHeader>
          <Table.Thead>
            {table.getHeaderGroups().map((group) => (
              <Table.Tr key={group.id}>
                {group.headers.map((header) => (
                  <Table.Th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler?.()}
                    style={{
                      cursor: header.column.getCanSort() ? "pointer" : "default",
                    }}
                  >
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </Table.Th>
                ))}
              </Table.Tr>
            ))}
          </Table.Thead>
          <Table.Tbody>
            {table.getRowModel().rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={memoColumns.length}>
                  <Text c="dimmed" size="sm">
                    No rows.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const id = getRowId?.(row.original);
                const selected = Boolean(id && selectedId === id);
                return (
                  <Table.Tr
                    key={row.id}
                    bg={selected ? "var(--mantine-color-scan-0)" : undefined}
                    onClick={
                      onRowClick
                        ? () => onRowClick(row.original)
                        : undefined
                    }
                    style={onRowClick ? { cursor: "pointer" } : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                );
              })
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {pageCount > 1 ? (
        <Group justify="space-between" mt="sm">
          <Text size="xs" c="dimmed">
            {data.length} rows
          </Text>
          <Pagination
            total={pageCount}
            value={pageIndex + 1}
            onChange={(page) => table.setPageIndex(page - 1)}
            size="sm"
          />
        </Group>
      ) : null}
    </div>
  );
}

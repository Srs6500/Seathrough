"use client";

import type { SchemaGuide } from "@/lib/schema-guide/types";

export function SchemaSource({
  guide,
  onOpenTable,
}: {
  guide: SchemaGuide;
  onOpenTable: (tableId: string) => void;
}) {
  const source = guide.schemaSource;

  return (
    <div className="mx-auto w-full max-w-[880px] px-8 py-10">
      <h1 className="text-[28px] font-medium tracking-[-0.03em] text-[#16161a]">
        Schema
      </h1>
      <p className="mt-2 text-[15px] text-[#71717a]">
        {source
          ? `The file that declares this database: ${source.path}`
          : "No schema file was found. Lists below were rebuilt from models in the code, if any."}
      </p>

      {source ? (
        <pre className="mt-6 overflow-x-auto rounded-2xl border border-[#ececee] bg-[#16161a] p-5 font-mono text-[12px] leading-relaxed text-[#f4f4f6]">
          {source.content}
        </pre>
      ) : (
        <div className="mt-6 space-y-4">
          {guide.tables.map((table) => (
            <section
              key={table.id}
              className="overflow-hidden rounded-2xl border border-[#ececee] bg-white"
            >
              <button
                type="button"
                onClick={() => onOpenTable(table.id)}
                className="flex w-full items-center justify-between border-b border-[#f0f0f3] px-4 py-3 text-left"
              >
                <span className="text-[14px] font-medium text-[#16161a]">
                  {table.modelName}
                </span>
                <span className="text-[12px] text-[#71717a]">{table.tableName}</span>
              </button>
              <ul>
                {table.fields.map((field) => (
                  <li
                    key={field.name}
                    className="flex items-center justify-between border-t border-[#f5f5f7] px-4 py-2 text-[13px]"
                  >
                    <span className="text-[#16161a]">
                      {field.name}
                      {field.isId ? " · pk" : ""}
                      {/id$/i.test(field.name) && !field.isId && !field.isRelation
                        ? " · fk"
                        : ""}
                    </span>
                    <span className="font-mono text-[12px] text-[#71717a]">
                      {field.type}
                      {field.list ? "[]" : ""}
                      {field.optional ? "?" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

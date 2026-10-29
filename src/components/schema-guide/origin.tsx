import type { FactOrigin, RelationOrigin } from "@/lib/schema-guide/types";

export function originLabel(origin: FactOrigin | RelationOrigin): string {
  if (origin === "declared") return "In the schema";
  if (origin === "implicit") return "Implied by Prisma";
  if (origin === "schema") return "From the schema";
  if (origin === "code") return "From the code";
  if (origin === "llm") return "Explained";
  return "Guessed from names";
}

export function OriginMark({
  origin,
}: {
  origin: FactOrigin | RelationOrigin;
}) {
  return (
    <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2 py-0.5 text-[11px] text-[#5b4fd4]">
      {originLabel(origin)}
    </span>
  );
}

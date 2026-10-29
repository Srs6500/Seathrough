import { query } from "@/lib/db";

export function Stats() {
  const rows = query();
  return <div>{rows.length}</div>;
}

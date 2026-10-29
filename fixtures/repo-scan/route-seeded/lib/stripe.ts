import { query } from "@/lib/database";

export function charge() {
  query();
  return true;
}

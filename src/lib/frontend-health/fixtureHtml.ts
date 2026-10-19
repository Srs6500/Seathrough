import { readFileSync } from "fs";
import path from "path";

export function loadBrokenDemoHtml(): string {
  const file = path.join(
    process.cwd(),
    "fixtures/frontend-health/broken-demo.html",
  );
  return readFileSync(file, "utf8");
}

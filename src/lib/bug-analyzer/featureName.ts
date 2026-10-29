/** Client-safe route → label helpers. Keep this file free of node: builtins. */

function displayName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\(\)$/, "")
    .trim();
}

function titleCaseWords(value: string): string {
  return displayName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function routeSegments(route: string): string[] {
  return route
    .split("/")
    .map((part) => part.trim().toLowerCase())
    .filter(
      (part) =>
        part &&
        part !== "api" &&
        !part.startsWith(":") &&
        !part.startsWith("{") &&
        !part.startsWith("(") &&
        !part.startsWith("@"),
    );
}

/** Human name for a route. `/smart-tutor` → Smart Tutor. `/` → Home. */
export function featureNameFromRoute(route: string): string {
  const segs = routeSegments(route);
  if (segs.length === 0) return "Home";
  return titleCaseWords(segs[segs.length - 1] || "page");
}

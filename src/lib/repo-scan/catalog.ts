import type { FeatureCatalog, StoredFeature } from "@/lib/repo-scan/types";

export function featuresForFile(
  catalog: FeatureCatalog | undefined,
  path: string,
): { path: string; primary: StoredFeature[]; shared: StoredFeature[] } {
  const cleaned = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!catalog || !cleaned) {
    return { path: cleaned, primary: [], shared: [] };
  }
  const slot = catalog.file_index[cleaned];
  const byId = new Map(
    [...catalog.features, ...catalog.infrastructure].map((item) => [
      item.feature_id,
      item,
    ]),
  );
  return {
    path: cleaned,
    primary: (slot?.primary ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is StoredFeature => Boolean(item)),
    shared: (slot?.shared ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is StoredFeature => Boolean(item)),
  };
}

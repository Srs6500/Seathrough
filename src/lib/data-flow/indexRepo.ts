import {
  describeUnknownStack,
  inferAppsFromPaths,
  isManifestPath,
  refineAppsFromManifests,
} from "@/lib/data-flow/discoverApps";
import { buildNextIndex } from "@/lib/data-flow/nextIndex";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import { buildExpressIndex } from "@/lib/data-flow/stacks/expressIndex";
import { buildFastapiIndex } from "@/lib/data-flow/stacks/fastapiIndex";
import { buildGoIndex } from "@/lib/data-flow/stacks/goIndex";
import { mergeIndexes } from "@/lib/data-flow/stacks/shared";
import { buildViteReactIndex } from "@/lib/data-flow/stacks/viteReactIndex";
import type { IndexedFramework, RepoIndex } from "@/lib/data-flow/types";

export function primaryFramework(index: RepoIndex): IndexedFramework {
  const kinds = index.frameworks ?? [];
  if (kinds.includes("nextjs") || kinds.includes("nextjs-ts")) return "nextjs-ts";
  if (kinds.includes("react") || kinds.includes("vite")) return "react";
  if (kinds.includes("express")) return "express";
  if (kinds.includes("fastapi")) return "fastapi";
  if (kinds.includes("go")) return "go";
  return index.frameworkOk ? "nextjs-ts" : "unknown";
}

/**
 * Index whatever stacks we can parse from the downloaded snapshot.
 * Next, Vite/React, Express, FastAPI, and Go adapters are merged.
 */
export function indexRepo(files: RepoSourceFile[]): RepoIndex {
  const parts: RepoIndex[] = [
    buildNextIndex(files),
    buildViteReactIndex(files),
    buildExpressIndex(files),
    buildFastapiIndex(files),
    buildGoIndex(files),
  ];
  const merged = mergeIndexes(parts);
  if (merged.frameworkOk) return merged;

  const apps = refineAppsFromManifests(
    files.filter((f) => isManifestPath(f.path)),
    inferAppsFromPaths(files.map((f) => f.path)),
  );
  const adapterNotes = parts.flatMap((part) => part.warnings);
  return {
    frameworkOk: false,
    warnings: [describeUnknownStack(apps), ...adapterNotes].filter(Boolean),
    symbols: [],
    edges: [],
    frameworks: apps.map((app) => app.kind),
  };
}

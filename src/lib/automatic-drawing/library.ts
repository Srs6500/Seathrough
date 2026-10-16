import { readdirSync, readFileSync } from "fs";
import path from "path";

export type LibraryElement = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  groupIds?: string[];
  boundElements?: Array<{ id: string; type: string }> | null;
  containerId?: string | null;
  startBinding?: { elementId: string; focus: number; gap: number } | null;
  endBinding?: { elementId: string; focus: number; gap: number } | null;
};

export type DrawingLibraryItem = {
  /** Global index used by the planner */
  index: number;
  id: string;
  pack: string;
  packFile: string;
  name: string;
  description: string;
  elementCount: number;
  types: string[];
  width: number;
  height: number;
  elements: LibraryElement[];
};

export type DrawingPackMeta = {
  pack: string;
  packFile: string;
  itemCount: number;
  topics: string;
};

type V2LibraryItem = {
  id?: string;
  name?: string;
  elements?: LibraryElement[];
};

type ExcalidrawLibFile = {
  type?: string;
  version?: number;
  library?: LibraryElement[][];
  libraryItems?: V2LibraryItem[];
};

/** Fallback names for packs that use the old `library` array without item names. */
const PACK_ITEM_FALLBACKS: Record<string, string[]> = {
  "software-architecture": [
    "microservice hexagon",
    "blue database",
    "red diamond stack / queue",
    "green cache store",
    "server stack",
    "browser window",
    "mobile phone",
  ],
  "system-design": [
    "server box",
    "application server",
    "multi-instance server",
  ],
  robots: ["robot", "robot variant", "robot body"],
  polygons: ["triangle", "square", "pentagon", "hexagon", "octagon", "star"],
  "Logic-Gates": [
    "AND gate",
    "OR gate",
    "NOT gate",
    "NAND gate",
    "NOR gate",
    "XOR gate",
    "XNOR gate",
    "buffer",
    "logic gate",
    "logic gate",
  ],
};

const PACK_TOPICS: Record<string, string> = {
  "software-architecture": "APIs, microservices, databases, browsers, mobile",
  "system-design": "servers, scaling, system design boxes",
  "data-viz": "charts, bars, data visualization",
  "decision-flow-control": "conditions, branching flow control",
  forms: "UI forms, buttons, inputs",
  gantt: "project timelines / gantt",
  "math-teacher-library": "grids, number lines, Venn diagrams, math teaching",
  "organic-chemistry-basics": "chemistry atoms and functional groups",
  biology: "cells, virus, bacteria, brain",
  "playing-cards": "playing cards",
  polygons: "basic polygons",
  "presentation-templates": "slide / presentation frames",
  "awesome-slides": "presentation layouts and titles",
  robots: "robots and machines",
  "some-handdrawn-signs": "check and cross marks",
  "stick-figures": "people / stick figures",
  storytelling: "story scenes and characters",
  "uml-library-activity-diagram": "UML activity diagram nodes",
  "Logic-Gates": "digital logic gates",
};

function drawingsDir(): string {
  const root = /* turbopackIgnore: true */ process.cwd();
  const publicLibs = path.join(root, "public", "libraries");
  const assetsDir = path.join(root, "assets", "drawings");
  try {
    if (
      readdirSync(/* turbopackIgnore: true */ publicLibs).some((f) =>
        f.toLowerCase().endsWith(".excalidrawlib"),
      )
    ) {
      return publicLibs;
    }
  } catch {
    // fall through
  }
  return assetsDir;
}

function boundsOf(elements: LibraryElement[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const w = typeof el.width === "number" ? el.width : 0;
    const h = typeof el.height === "number" ? el.height : 0;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + w);
    maxY = Math.max(maxY, el.y + h);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 40, maxY: 40, width: 40, height: 40 };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function firstText(elements: LibraryElement[]): string | null {
  for (const el of elements) {
    if (el.type === "text" && typeof el.text === "string" && el.text.trim()) {
      return el.text.trim().replace(/\s+/g, " ").slice(0, 60);
    }
  }
  return null;
}

function packSlug(fileName: string): string {
  return fileName.replace(/\.excalidrawlib$/i, "");
}

function extractItems(
  fileName: string,
  raw: ExcalidrawLibFile,
): Array<{ name: string; elements: LibraryElement[] }> {
  const pack = packSlug(fileName);
  const fallbacks = PACK_ITEM_FALLBACKS[pack] ?? [];

  if (Array.isArray(raw.libraryItems) && raw.libraryItems.length) {
    return raw.libraryItems
      .map((item, i) => {
        const elements = Array.isArray(item.elements) ? item.elements : [];
        if (!elements.length) return null;
        const name =
          item.name?.trim() ||
          firstText(elements) ||
          fallbacks[i] ||
          `${pack} item ${i}`;
        return { name, elements };
      })
      .filter(Boolean) as Array<{ name: string; elements: LibraryElement[] }>;
  }

  if (Array.isArray(raw.library) && raw.library.length) {
    return raw.library
      .map((elements, i) => {
        if (!Array.isArray(elements) || !elements.length) return null;
        const name =
          firstText(elements) || fallbacks[i] || `${pack} item ${i}`;
        return { name, elements };
      })
      .filter(Boolean) as Array<{ name: string; elements: LibraryElement[] }>;
  }

  return [];
}

let cachedItems: DrawingLibraryItem[] | null = null;
let cachedPacks: DrawingPackMeta[] | null = null;

export function loadAllDrawingLibraries(): DrawingLibraryItem[] {
  if (cachedItems) return cachedItems;

  const dir = drawingsDir();
  const files = readdirSync(/* turbopackIgnore: true */ dir)
    .filter((f) => f.toLowerCase().endsWith(".excalidrawlib"))
    .sort((a, b) => a.localeCompare(b));

  const items: DrawingLibraryItem[] = [];
  const packs: DrawingPackMeta[] = [];

  for (const fileName of files) {
    const filePath = path.join(dir, fileName);
    let raw: ExcalidrawLibFile;
    try {
      raw = JSON.parse(
        readFileSync(/* turbopackIgnore: true */ filePath, "utf8"),
      ) as ExcalidrawLibFile;
    } catch {
      continue;
    }

    const pack = packSlug(fileName);
    const extracted = extractItems(fileName, raw);
    packs.push({
      pack,
      packFile: fileName,
      itemCount: extracted.length,
      topics: PACK_TOPICS[pack] ?? pack.replace(/-/g, " "),
    });

    for (const entry of extracted) {
      const index = items.length;
      const b = boundsOf(entry.elements);
      const types = [...new Set(entry.elements.map((e) => e.type))];
      items.push({
        index,
        id: `${pack}:${index}`,
        pack,
        packFile: fileName,
        name: entry.name,
        description: `${entry.name} (${pack})`,
        elementCount: entry.elements.length,
        types,
        width: Math.round(b.width),
        height: Math.round(b.height),
        elements: entry.elements,
      });
    }
  }

  cachedItems = items;
  cachedPacks = packs;
  return items;
}

export function listDrawingPacks(): DrawingPackMeta[] {
  if (!cachedPacks) loadAllDrawingLibraries();
  return cachedPacks ?? [];
}

/** @deprecated use loadAllDrawingLibraries */
export function loadArchitectureLibrary(): DrawingLibraryItem[] {
  return loadAllDrawingLibraries();
}

export type ArchitectureLibraryItem = DrawingLibraryItem;

export function libraryCatalogForPrompt(
  maxItems = 260,
  options?: { packs?: string[] },
): string {
  const packFilter = options?.packs?.length
    ? new Set(options.packs)
    : null;
  const all = loadAllDrawingLibraries();
  const items = (
    packFilter ? all.filter((item) => packFilter.has(item.pack)) : all
  ).slice(0, maxItems);
  const packs = listDrawingPacks().filter((p) =>
    packFilter ? packFilter.has(p.pack) : true,
  );
  const packLines = packs
    .map((p) => `- ${p.pack} (${p.itemCount}): ${p.topics}`)
    .join("\n");
  const itemLines = items
    .map(
      (item) =>
        `- ${item.index}: [${item.pack}] ${item.name} (${item.width}×${item.height})`,
    )
    .join("\n");
  return `Packs:\n${packLines}\n\nShapes (use itemIndex):\n${itemLines}`;
}

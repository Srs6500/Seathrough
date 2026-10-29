"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RepoWithStack } from "@/lib/bug-analyzer/client";
import type { StoredFeature, TreeSitterParseResult } from "@/lib/repo-scan/types";

export const REPO_SCAN_HOME = "/repo-scan";
const STORAGE_KEY = "seethrough.repo-scan.session.v1";

export type RepoScanSessionSnapshot = {
  repo: RepoWithStack;
  parse: TreeSitterParseResult;
};

export function featureDetailPath(featureId: string): string {
  return `/repo-scan/features/${encodeURIComponent(featureId)}`;
}

function slimParse(parse: TreeSitterParseResult): TreeSitterParseResult {
  return {
    ...parse,
    files: (parse.files ?? []).map((file) => ({
      ...file,
      content: undefined,
      sexp: "",
    })),
  };
}

function readStored(): RepoScanSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RepoScanSessionSnapshot;
    if (!parsed?.repo?.fullName || !parsed.parse) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(repo: RepoWithStack, parse: TreeSitterParseResult) {
  const snapshot: RepoScanSessionSnapshot = {
    repo,
    parse: slimParse(parse),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return;
  } catch {
    // File payloads can exceed quota; keep catalog so feature pages still work.
  }
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        repo,
        parse: {
          ...slimParse(parse),
          files: [],
        },
      }),
    );
  } catch {
    // In-memory session still works in this tab.
  }
}

function clearStored() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

type ScanSessionValue = {
  selected: RepoWithStack | null;
  parse: TreeSitterParseResult | null;
  hydrated: boolean;
  setSelected: (repo: RepoWithStack | null) => void;
  setParse: (parse: TreeSitterParseResult | null) => void;
  beginScan: (repo: RepoWithStack) => void;
  rememberScan: (repo: RepoWithStack, parse: TreeSitterParseResult) => void;
  resetScan: () => void;
  featureById: (featureId: string) => StoredFeature | null;
};

const ScanSessionContext = createContext<ScanSessionValue | null>(null);

export function ScanSessionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelectedState] = useState<RepoWithStack | null>(null);
  const [parse, setParseState] = useState<TreeSitterParseResult | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setSelectedState(stored.repo);
      setParseState(stored.parse);
    }
    setHydrated(true);
  }, []);

  const setSelected = useCallback((repo: RepoWithStack | null) => {
    setSelectedState(repo);
    if (!repo) clearStored();
  }, []);

  const setParse = useCallback((next: TreeSitterParseResult | null) => {
    setParseState(next);
  }, []);

  const beginScan = useCallback((repo: RepoWithStack) => {
    setSelectedState(repo);
    setParseState(null);
    clearStored();
  }, []);

  const rememberScan = useCallback(
    (repo: RepoWithStack, next: TreeSitterParseResult) => {
      setSelectedState(repo);
      setParseState(next);
      writeStored(repo, next);
    },
    [],
  );

  const resetScan = useCallback(() => {
    setSelectedState(null);
    setParseState(null);
    clearStored();
  }, []);

  const featureById = useCallback(
    (featureId: string) =>
      parse?.catalog?.features.find((item) => item.feature_id === featureId) ??
      null,
    [parse],
  );

  const value = useMemo(
    () => ({
      selected,
      parse,
      hydrated,
      setSelected,
      setParse,
      beginScan,
      rememberScan,
      resetScan,
      featureById,
    }),
    [
      selected,
      parse,
      hydrated,
      setSelected,
      setParse,
      beginScan,
      rememberScan,
      resetScan,
      featureById,
    ],
  );

  return (
    <ScanSessionContext.Provider value={value}>
      {children}
    </ScanSessionContext.Provider>
  );
}

export function useScanSession(): ScanSessionValue {
  const value = useContext(ScanSessionContext);
  if (!value) {
    throw new Error("useScanSession must be used inside ScanSessionProvider.");
  }
  return value;
}

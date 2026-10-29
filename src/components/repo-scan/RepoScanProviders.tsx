"use client";

import {
  MantineProvider,
  createTheme,
  type MantineColorsTuple,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { ScanSessionProvider } from "@/lib/repo-scan/session";

const scan: MantineColorsTuple = [
  "#eef5f9",
  "#d7e3ec",
  "#b0c4d4",
  "#84a3bb",
  "#5a86a4",
  "#3d6e90",
  "#2a5f7a",
  "#17324a",
  "#12283b",
  "#0c1c2a",
];

const theme = createTheme({
  primaryColor: "scan",
  colors: { scan },
  fontFamily: "var(--font-geist), var(--font-inter), system-ui, sans-serif",
  defaultRadius: "md",
});

export function RepoScanProviders({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="light"
      forceColorScheme="light"
      cssVariablesSelector="#repo-scan-root"
      classNamesPrefix="st-scan"
      getRootElement={() =>
        typeof document === "undefined"
          ? undefined
          : (document.getElementById("repo-scan-root") ?? undefined)
      }
    >
      <div id="repo-scan-root" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScanSessionProvider>{children}</ScanSessionProvider>
      </div>
    </MantineProvider>
  );
}

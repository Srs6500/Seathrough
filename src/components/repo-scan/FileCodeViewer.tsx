"use client";

import dynamic from "next/dynamic";
import { Loader, Text } from "@mantine/core";
import type { TreeSitterFile } from "@/lib/repo-scan/types";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <Loader size="sm" />,
});

const LANGUAGE: Record<string, string> = {
  tsx: "typescript",
  ts: "typescript",
  typescript: "typescript",
  jsx: "javascript",
  js: "javascript",
  javascript: "javascript",
  python: "python",
  py: "python",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  markdown: "markdown",
};

function monacoLanguage(file: TreeSitterFile): string {
  const fromParse = (file.language || "").toLowerCase();
  if (LANGUAGE[fromParse]) return LANGUAGE[fromParse];
  const ext = file.path.split(".").pop()?.toLowerCase() || "";
  return LANGUAGE[ext] || "plaintext";
}

export function FileCodeViewer({ file }: { file: TreeSitterFile | null }) {
  if (!file) {
    return (
      <Text c="dimmed" size="sm">
        Pick a file to open it in the editor.
      </Text>
    );
  }
  const value =
    file.content ||
    file.sexp ||
    file.reason ||
    "No source was stored for this file.";
  return (
    <Editor
      height="100%"
      language={file.content ? monacoLanguage(file) : "plaintext"}
      value={value}
      theme="vs"
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 13,
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
      path={file.path}
    />
  );
}

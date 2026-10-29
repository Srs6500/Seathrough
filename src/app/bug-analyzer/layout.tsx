import { redirect } from "next/navigation";

/** Debugger is folded into Vibe coder; keep old URLs from landing on a dead product. */
export default function BugAnalyzerLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  redirect("/vibe-coder");
}

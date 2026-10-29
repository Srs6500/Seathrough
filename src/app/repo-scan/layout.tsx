import { redirect } from "next/navigation";

/** Repo-Scan is folded into Vibe coder; keep old URLs from landing on a dead product. */
export default function RepoScanLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  redirect("/vibe-coder");
}

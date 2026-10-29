import { RepoScanProviders } from "@/components/repo-scan/RepoScanProviders";

export default function RepoScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RepoScanProviders>{children}</RepoScanProviders>;
}

"use client";

import { Button, Loader, Text } from "@mantine/core";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { AccountMenu } from "@/components/lms/AccountMenu";
import { AppHeader } from "@/components/lms/AppHeader";
import { AppShell } from "@/components/lms/AppShell";
import { FeatureVerifyCard } from "@/components/repo-scan/FeatureVerifyCard";
import { SandboxSettings } from "@/components/repo-scan/SandboxSettings";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import { parseGithubRepoWithTreeSitter } from "@/lib/repo-scan/client";
import type { RepoScanSandboxInput } from "@/lib/repo-scan/sandbox";
import { REPO_SCAN_HOME, useScanSession } from "@/lib/repo-scan/session";

export function FeatureDetailPage({ featureId }: { featureId: string }) {
  const { openAuth } = useQuestionAccess();
  const { accessToken } = useAuth();
  const { hydrated, selected, featureById, rememberScan } = useScanSession();
  const feature = featureById(featureId);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const account = (
    <AccountMenu
      onLogin={() => openAuth("login")}
      onSignup={() => openAuth("signup")}
    />
  );

  async function rescan(sandbox: RepoScanSandboxInput) {
    if (!accessToken) {
      openAuth("login");
      return;
    }
    if (!selected) {
      setScanError("Go back and pick the repository first.");
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const next = await parseGithubRepoWithTreeSitter(
        accessToken,
        selected.fullName,
        selected.defaultBranch,
        sandbox,
      );
      rememberScan(selected, next);
    } catch (error) {
      setScanError(
        error instanceof Error ? error.message : "Could not scan this repository.",
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <AppHeader current="repo-scan" title="Repo-Scan" account={account} />
        <section className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
          <div className="mx-auto w-full max-w-xl">
            <Link
              href={REPO_SCAN_HOME}
              className="text-sm text-[#5a7388] no-underline hover:text-[#17324a]"
            >
              Features
            </Link>

            {!hydrated ? (
              <div className="mt-16 flex items-center gap-3">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  Loading…
                </Text>
              </div>
            ) : !feature ? (
              <div className="mt-10">
                <p className="text-2xl font-semibold tracking-tight text-[#17324a]">
                  Nothing here
                </p>
                <p className="mt-3 text-[1.05rem] leading-7 text-[#5a7388]">
                  {accessToken
                    ? "Scan the repo again, then open a feature."
                    : "Sign in and scan a repo first."}
                </p>
                <Button
                  component="a"
                  href={REPO_SCAN_HOME}
                  mt="lg"
                  variant="light"
                >
                  Back
                </Button>
              </div>
            ) : (
              <div className="mt-8">
                <h1 className="text-[1.65rem] font-semibold tracking-tight text-[#17324a]">
                  {feature.name}
                </h1>
                <div className="mt-8">
                  <FeatureVerifyCard feature={feature} />
                </div>
                <div className="mt-12">
                    {scanError ? (
                      <Text size="sm" c="red" mb="sm">
                        {scanError}
                      </Text>
                    ) : null}
                    <SandboxSettings
                      disabled={scanning}
                      scanLabel={scanning ? "Scanning…" : "Try again"}
                      onScan={(sandbox) => void rescan(sandbox)}
                    />
                  </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

"use client";

import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Link2,
  Lock,
  Terminal,
} from "lucide-react";
import type { VibeGithubRepo } from "@/lib/vibe-coder/client";
import type { VibeSandbox } from "@/lib/vibe-coder/types";

type SetupStep = 1 | 2;

export function VibeOnboard({
  connected,
  githubLogin,
  repos,
  query,
  sandbox,
  busy,
  error,
  onQuery,
  onSandbox,
  onConnect,
  onOpen,
  onLogout,
}: {
  connected: boolean;
  githubLogin: string | null;
  repos: VibeGithubRepo[];
  query: string;
  sandbox: VibeSandbox;
  busy: boolean;
  error: string | null;
  onQuery: (value: string) => void;
  onSandbox: (value: VibeSandbox) => void;
  onConnect: () => void;
  onOpen: (fullName: string) => void;
  onLogout: () => void;
}) {
  const step: SetupStep = connected ? 2 : 1;

  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)] flex-col">
      <SetupSteps step={step} />
      <div className="flex flex-1 flex-col items-center px-4 pb-16 pt-10">
        {step === 1 ? (
          <ConnectGithubCard onConnect={onConnect} onOpen={onOpen} />
        ) : null}

        {step === 2 ? (
          <ChooseRepoCard
            githubLogin={githubLogin}
            repos={repos}
            query={query}
            sandbox={sandbox}
            busy={busy}
            onQuery={onQuery}
            onSandbox={onSandbox}
            onOpen={onOpen}
            onConnect={onConnect}
            onLogout={onLogout}
          />
        ) : null}

        {error ? (
          <p className="mt-6 max-w-md text-center text-sm text-[#b42318]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

function SetupSteps({ step }: { step: SetupStep }) {
  const items: Array<{ n: SetupStep; label: string }> = [
    { n: 1, label: "Connect GitHub" },
    { n: 2, label: "Workspace" },
  ];
  return (
    <ol className="flex items-center justify-center gap-3 pt-6 text-[13px] text-[#6b6b73]">
      {items.map((item, index) => {
        const done = item.n < step;
        const current = item.n === step;
        return (
          <li key={item.n} className="flex items-center gap-3">
            {index > 0 ? (
              <span className="h-px w-6 bg-[#d9d9de]" aria-hidden />
            ) : null}
            <span className="flex items-center gap-2">
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[11px] font-medium ${
                  done
                    ? "bg-[#111] text-white"
                    : current
                      ? "bg-[#5b5cff] text-white"
                      : "border border-[#d0d0d6] text-[#8a8a93]"
                }`}
              >
                {done ? <Check className="size-3" strokeWidth={2.5} /> : item.n}
              </span>
              <span className={current ? "text-[#111]" : undefined}>{item.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function OnboardCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="w-full max-w-[440px] rounded-3xl bg-white px-8 py-10 shadow-[0_18px_50px_rgba(17,17,20,0.08)]">
      {children}
    </section>
  );
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.04 1.53 1.04.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

function IconPair() {
  return (
    <div className="flex items-center justify-center gap-3">
      <span className="flex size-11 items-center justify-center rounded-full bg-[#f3f3f5] text-[#111]">
        <GithubMark className="size-5" />
      </span>
      <Link2 className="size-4 text-[#b0b0b8]" />
      <span className="flex size-11 items-center justify-center rounded-[14px] bg-[#111] text-white">
        <Terminal className="size-5" />
      </span>
    </div>
  );
}

function ConnectGithubCard({
  onConnect,
  onOpen,
}: {
  onConnect: () => void;
  onOpen: (fullName: string) => void;
}) {
  const [publicName, setPublicName] = useState("");
  const [skip, setSkip] = useState(false);

  return (
    <>
      <OnboardCard>
        <IconPair />
        <h1 className="mt-7 text-center text-[28px] font-semibold tracking-[-0.03em] text-[#111]">
          Connect your GitHub
        </h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-center text-[15px] leading-relaxed text-[#6b6b73]">
          Bring a repository into SeeThrough so we can walk through what the app
          actually does.
        </p>
        <ul className="mt-8 space-y-4">
          <Benefit
            icon={<Code2 className="size-4" />}
            title="Start with the code you already have"
            detail="Find a repository and we will read the pages and features in it."
          />
          <Benefit
            icon={<Lock className="size-4" />}
            title="Keep the walkthrough next to the files"
            detail="Each step points at the file that implements it."
          />
        </ul>
        <div className="mt-6 rounded-2xl bg-[#f6f6f8] px-4 py-3.5">
          <p className="flex items-start gap-2 text-[14px] font-medium text-[#111]">
            <Link2 className="mt-0.5 size-4 shrink-0 text-[#6b6b73]" />
            You choose what to share
          </p>
          <p className="mt-1 pl-6 text-[13px] leading-relaxed text-[#6b6b73]">
            Next, GitHub will show the requested permissions and let you choose
            which repositories SeeThrough can access.
          </p>
        </div>
        <button
          type="button"
          onClick={onConnect}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#5b5cff] text-[15px] font-medium text-white transition hover:bg-[#4d4ef0]"
        >
          <GithubMark className="size-4" />
          Connect GitHub
          <ArrowUpRight className="size-4" />
        </button>
        <p className="mt-3 text-center text-[12px] text-[#8a8a93]">
          You will continue on GitHub to authorize the connection.
        </p>
      </OnboardCard>

      <div className="mt-8 text-center">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[14px] text-[#111]"
          onClick={() => setSkip((value) => !value)}
        >
          Skip for now
          <ArrowRight className="size-3.5" />
        </button>
        <p className="mt-1 text-[12px] text-[#8a8a93]">
          You can still open a public repository by name.
        </p>
        {skip ? (
          <form
            className="mx-auto mt-4 flex w-full max-w-[440px] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (publicName.trim()) onOpen(publicName.trim());
            }}
          >
            <input
              value={publicName}
              onChange={(event) => setPublicName(event.target.value)}
              placeholder="owner/repo"
              className="h-11 flex-1 rounded-full border border-[#e4e4e8] bg-white px-4 text-sm outline-none focus:border-[#5b5cff]"
            />
            <button
              type="submit"
              className="h-11 rounded-full bg-[#111] px-4 text-sm text-white"
            >
              Open
            </button>
          </form>
        ) : null}
      </div>
    </>
  );
}

function ChooseRepoCard({
  githubLogin,
  repos,
  query,
  sandbox,
  busy,
  onQuery,
  onSandbox,
  onOpen,
  onConnect,
  onLogout,
}: {
  githubLogin: string | null;
  repos: VibeGithubRepo[];
  query: string;
  sandbox: VibeSandbox;
  busy: boolean;
  onQuery: (value: string) => void;
  onSandbox: (value: VibeSandbox) => void;
  onOpen: (fullName: string) => void;
  onConnect: () => void;
  onLogout: () => void;
}) {
  const [more, setMore] = useState(false);

  return (
    <OnboardCard>
      <IconPair />
      <h1 className="mt-7 text-center text-[28px] font-semibold tracking-[-0.03em] text-[#111]">
        Choose a repository
      </h1>
      <p className="mx-auto mt-2 max-w-[36ch] text-center text-[15px] leading-relaxed text-[#6b6b73]">
        Pick the project you want to understand. We will read it and build a
        walkthrough of the real features.
      </p>
      {githubLogin ? (
        <p className="mt-3 text-center text-[13px] text-[#6b6b73]">
          Connected as <span className="font-medium text-[#111]">{githubLogin}</span>
        </p>
      ) : null}
      <label className="mt-7 block">
        <span className="sr-only">Search repositories</span>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search owner/repo"
          className="h-11 w-full rounded-full border border-[#e4e4e8] bg-[#fafafa] px-4 text-sm outline-none focus:border-[#5b5cff] focus:bg-white"
        />
      </label>
      <ul className="mt-3 max-h-[280px] overflow-y-auto rounded-2xl border border-[#eeeef1]">
        {repos.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-[#8a8a93]">
            No repositories matched that search.
          </li>
        ) : (
          repos.map((repo) => (
            <li key={repo.id} className="border-b border-[#f0f0f3] last:border-b-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpen(repo.fullName)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-[#fafafa] disabled:opacity-50"
              >
                <span className="truncate text-[#111]">{repo.fullName}</span>
                <span className="ml-3 shrink-0 text-[12px] text-[#8a8a93]">
                  {busy ? "Reading…" : repo.defaultBranch}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onConnect}
          className="text-[13px] text-[#5b5cff]"
        >
          Connect a different GitHub
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="text-[13px] text-[#6b6b73]"
        >
          Log out
        </button>
      </div>
      <button
        type="button"
        className="mt-4 block text-[13px] text-[#6b6b73]"
        onClick={() => setMore((value) => !value)}
      >
        {more ? "Hide running app details" : "The app is already running"}
      </button>
      {more ? (
        <div className="mt-3 space-y-3">
          <QuietField
            label="App URL"
            value={sandbox.baseUrl}
            placeholder="http://127.0.0.1:5173"
            onChange={(baseUrl) => onSandbox({ ...sandbox, baseUrl })}
          />
          <QuietField
            label="API URL"
            value={sandbox.apiUrl}
            placeholder="http://127.0.0.1:8000"
            onChange={(apiUrl) => onSandbox({ ...sandbox, apiUrl })}
          />
          <QuietField
            label="Test login"
            value={sandbox.user}
            onChange={(user) => onSandbox({ ...sandbox, user })}
          />
          <QuietField
            label="Password"
            type="password"
            value={sandbox.password}
            onChange={(password) => onSandbox({ ...sandbox, password })}
          />
        </div>
      ) : null}
    </OnboardCard>
  );
}

function Benefit({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f3f3f5] text-[#111]">
        {icon}
      </span>
      <span>
        <span className="block text-[14px] font-medium text-[#111]">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-[#6b6b73]">
          {detail}
        </span>
      </span>
    </li>
  );
}

function QuietField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-[#6b6b73]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-xl border border-[#e4e4e8] bg-[#fafafa] px-3 text-sm outline-none focus:border-[#5b5cff] focus:bg-white"
      />
    </label>
  );
}

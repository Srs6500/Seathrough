"use client";

import {
  CreditCard,
  FormInput,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Navigation,
  Search,
  Settings,
  Table2,
  Upload,
  AppWindow,
  Route,
  Shield,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import type { ComponentCard } from "@/lib/data-flow/componentScan";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const KIND_ICON: Record<string, LucideIcon> = {
  login: Lock,
  signup: Lock,
  search: Search,
  navigation: Navigation,
  dashboard: LayoutDashboard,
  profile: Settings,
  checkout: CreditCard,
  chat: MessageSquare,
  upload: Upload,
  modal: AppWindow,
  "data-table": Table2,
  auth: Shield,
  "api-route": Route,
  form: FormInput,
  component: Boxes,
};

type Props = {
  cards: ComponentCard[];
  repoName: string;
  fileCount: number;
  truncated: boolean;
};

export function ComponentCardGrid({
  cards,
  repoName,
  fileCount,
  truncated,
}: Props) {
  if (cards.length === 0) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 text-center text-sm text-[#5a7388]">
        Scanned {fileCount} files in{" "}
        <span className="font-medium text-[#17324a]">{repoName}</span>
        {truncated ? " (partial tree)" : ""}. No clear UI components were
        detected. Try a frontend-heavy repo.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-[#17324a]">{repoName}</h2>
          <p className="text-sm text-[#5a7388]">
            {cards.length} component{cards.length === 1 ? "" : "s"} from{" "}
            {fileCount} files
            {truncated ? " · partial scan" : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = KIND_ICON[card.kind] ?? Boxes;
          const topPath = card.evidence[0]?.path;
          return (
            <Card
              key={card.id}
              size="sm"
              className="bg-white shadow-none ring-[#d7e3eb]"
            >
              <CardHeader className="gap-2">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef5f9] text-[#2a5f7a]">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base text-[#17324a]">
                      {card.title}
                    </CardTitle>
                    <CardDescription className="mt-1 text-[#5a7388]">
                      {card.summary}
                    </CardDescription>
                    {topPath ? (
                      <p
                        className="mt-2 truncate font-mono text-[11px] text-[#7a93a8]"
                        title={topPath}
                      >
                        {topPath}
                      </p>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

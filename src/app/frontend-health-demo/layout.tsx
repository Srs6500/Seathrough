import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Frontend health demo",
  robots: NO_INDEX,
};

export default function FrontendHealthDemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

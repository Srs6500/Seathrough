import type { Metadata } from "next";
import { MarketingHome } from "@/components/site/MarketingHome";

export const metadata: Metadata = {
  title: "SeeThrough",
  description:
    "Ask about a topic, a system, or your own code. SeeThrough draws the answer so you can follow it.",
};

export default function HomePage() {
  return <MarketingHome />;
}

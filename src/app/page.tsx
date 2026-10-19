import type { Metadata } from "next";
import { MarketingHome } from "@/components/site/MarketingHome";

export const metadata: Metadata = {
  title: "SeeThrough",
  description:
    "System design and debugging visuals — SeeThrough draws the explanation so you can watch and learn.",
};

export default function HomePage() {
  return <MarketingHome />;
}

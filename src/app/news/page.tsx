import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { NewsWorkspace } from "@/components/news/NewsWorkspace";
import { newsMode } from "@/modules/news/mode";

export const metadata: Metadata = pageMetadata({
  title: newsMode.metaTitle,
  description: newsMode.metaDescription,
  path: "/news",
});

export default function NewsPage() {
  return <NewsWorkspace />;
}

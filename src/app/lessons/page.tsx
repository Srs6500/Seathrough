import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Workspace } from "@/modules/lessons";
import { lessonsMode } from "@/modules/lessons/mode";

export const metadata: Metadata = pageMetadata({
  title: lessonsMode.metaTitle,
  description: lessonsMode.metaDescription,
  path: "/lessons",
});

export default function LessonsPage() {
  return (
    <Workspace />
  );
}

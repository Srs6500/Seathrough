import type { Metadata } from "next";
import { CourseGeneratorWorkspace } from "@/components/course-generator/CourseGeneratorWorkspace";
import { pageMetadata } from "@/lib/seo";
import { courseGeneratorMode } from "@/modules/course-generator/mode";

export const metadata: Metadata = pageMetadata({
  title: courseGeneratorMode.metaTitle,
  description: courseGeneratorMode.metaDescription,
  path: "/course-generator",
});

export default function CourseGeneratorPage() {
  return <CourseGeneratorWorkspace />;
}

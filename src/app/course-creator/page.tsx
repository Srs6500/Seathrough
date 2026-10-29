import type { Metadata } from "next";
import { CourseCreatorWorkspace } from "@/components/course-creator/CourseCreatorWorkspace";
import { courseCreatorMode } from "@/modules/course-creator/mode";

export const metadata: Metadata = {
  title: courseCreatorMode.metaTitle,
  description: courseCreatorMode.metaDescription,
};

export default function CourseCreatorPage() {
  return <CourseCreatorWorkspace />;
}

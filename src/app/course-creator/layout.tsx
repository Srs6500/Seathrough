import { redirect } from "next/navigation";

/** Course creator is retired; keep old URLs from landing on a dead product. */
export default function CourseCreatorLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  redirect("/smart-tutor");
}

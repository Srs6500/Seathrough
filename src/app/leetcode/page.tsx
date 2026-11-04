import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/seo";
import { Workspace } from "@/modules/leetcode";
import { leetcodeMode } from "@/modules/leetcode/mode";

export const metadata: Metadata = {
  title: leetcodeMode.metaTitle,
  description: leetcodeMode.metaDescription,
  robots: NO_INDEX,
};

export default function LeetcodePage() {
  return (
    <Workspace />
  );
}

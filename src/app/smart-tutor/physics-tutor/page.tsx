import type { Metadata } from "next";
import { ExperimentBoard } from "@/components/experiment/ExperimentBoard";
import { physicsTutorMode } from "@/modules/physics-tutor/mode";

export const metadata: Metadata = {
  title: physicsTutorMode.metaTitle,
  description: physicsTutorMode.metaDescription,
};

export default function PhysicsTutorPage() {
  return <ExperimentBoard kind="physics" />;
}

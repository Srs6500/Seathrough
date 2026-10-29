import { redirect } from "next/navigation";
import { smartTutorHref } from "@/lib/smart-tutor/tutorStyle";

export default function PhysicsTutorPage() {
  redirect(smartTutorHref());
}

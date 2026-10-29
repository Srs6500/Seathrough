import { redirect } from "next/navigation";
import { smartTutorHref } from "@/lib/smart-tutor/tutorStyle";

export default function VoiceTutorPage() {
  redirect(smartTutorHref("text"));
}

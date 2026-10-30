import { redirect } from "next/navigation";

/** Video explainer is retired; lesson videos live in Smart tutor. Keep old URLs from landing on a dead product. */
export default function VideoPage() {
  redirect("/smart-tutor");
}

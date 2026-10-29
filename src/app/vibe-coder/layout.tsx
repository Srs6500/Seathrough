import { VibePageFrame } from "@/components/vibe-coder/VibePageFrame";
import "./vibe.css";

export default function VibeCoderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <VibePageFrame>{children}</VibePageFrame>;
}

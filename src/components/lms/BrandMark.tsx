import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  compact?: boolean;
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
};

export function BrandMark({
  className,
  compact = false,
  size = "sm",
  onDark = false,
}: BrandMarkProps) {
  const mark =
    size === "lg" ? "h-18 w-18" : size === "md" ? "h-11 w-11" : "h-8 w-8";
  const word = cn(
    "truncate font-medium tracking-tight",
    size === "lg"
      ? "text-xl md:text-2xl"
      : size === "md"
        ? "text-xl md:text-[1.65rem]"
        : "text-base md:text-lg",
    onDark ? "text-white" : "text-ink",
  );

  return (
    <Link
      href="/"
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img
        src="/SeeThrough_logo.png"
        alt=""
        className={cn("shrink-0 object-contain", mark)}
      />
      {compact ? (
        <span className="sr-only">SeeThrough home</span>
      ) : (
        <span className={word}>SeeThrough</span>
      )}
    </Link>
  );
}

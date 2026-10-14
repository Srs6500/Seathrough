import type { ModeId } from "@/modes/types";
import { BrandMark } from "@/components/lms/BrandMark";
import { StudyMenu } from "@/components/modes/ModeNav";
import { cn } from "@/lib/utils";

type AppHeaderProps = {
  current?: ModeId;
  eyebrow?: string;
  title?: string;
  /** Left of the brand — e.g. reopen-chats control. */
  leading?: React.ReactNode;
  /**
   * Centerpiece of the toolbar (usually the prompt). Sits inline between the
   * brand and the controls on md+, and drops to its own full-width row below.
   */
  center?: React.ReactNode;
  /** Extra controls before the study switcher. */
  actions?: React.ReactNode;
  account?: React.ReactNode;
  /** Full-width row under the toolbar (prompt bar, filters). */
  children?: React.ReactNode;
  /** Logo only, no wordmark — leaves room for `center`. */
  brandCompact?: boolean;
  className?: string;
};

export function AppHeader({
  current,
  eyebrow,
  title,
  leading,
  center,
  actions,
  account,
  children,
  brandCompact = false,
  className,
}: AppHeaderProps) {
  return (
    <header
      className={cn(
        "z-40 shrink-0 border-b border-[#d7e3eb] bg-white/94 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3 py-2.5 md:flex-nowrap md:px-4">
        {leading}
        <div className="flex min-w-0 shrink-0 items-center gap-2.5">
          <BrandMark compact={brandCompact} />
          {eyebrow || title ? (
            <div className="hidden min-w-0 max-w-44 lg:block">
              {eyebrow ? (
                <p className="text-[11px] font-medium text-muted">{eyebrow}</p>
              ) : null}
              {title ? (
                <p className="truncate text-[13px] font-semibold tracking-tight text-[#17324a]">
                  {title}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {center ? (
          <div className="order-last min-w-0 basis-full md:order-0 md:min-w-0 md:flex-1 md:basis-auto md:px-2">
            <div className="mx-auto w-full max-w-2xl">{center}</div>
          </div>
        ) : null}

        {/* shrink-0: never let Log in / Study / End get clipped or wrap under the prompt */}
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5 self-center">
          {actions}
          <StudyMenu current={current} />
          {account}
        </div>
      </div>
      {children ? (
        <div className="border-t border-[#d7e3eb] px-3 py-2.5 md:px-4">
          {children}
        </div>
      ) : null}
    </header>
  );
}

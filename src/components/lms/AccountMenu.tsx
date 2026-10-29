"use client";

import { LogOut, UserRound } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useOptionalTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AccountMenuProps = {
  onLogin: () => void;
  onSignup?: () => void;
  onLogout?: () => void;
  variant?: "default" | "marketing";
};

export function AccountMenu({
  onLogin,
  onSignup,
  onLogout,
  variant = "default",
}: AccountMenuProps) {
  const { user, loading, logout } = useAuth();
  const marketing = variant === "marketing";
  const { theme } = useOptionalTheme();
  const dark = marketing && theme === "dark";

  if (loading) {
    return (
      <div
        className={cn(
          "size-9 animate-pulse rounded-none",
          marketing
            ? dark
              ? "bg-white/15"
              : "bg-[#ececee]"
            : "bg-secondary",
        )}
        aria-hidden
      />
    );
  }

  if (!user) {
    if (marketing) {
      return (
        <button
          type="button"
          onClick={onLogin}
          className={cn(
            "hidden h-9 items-center rounded-lg border px-3 text-[13px] font-medium outline-none transition sm:inline-flex",
            dark
              ? "border-[#2a2a2e] text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/35"
              : "border-[#ececee] bg-white text-[#16161a] hover:bg-[#fafafa] focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/30",
          )}
        >
          Log in
        </button>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        {onSignup ? (
          <Button variant="ghost" size="sm" onClick={onSignup}>
            Sign up
          </Button>
        ) : null}
        <Button size="sm" onClick={onLogin}>
          Log in
        </Button>
      </div>
    );
  }

  const initial = user.username.slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="rounded-full"
          aria-label="Account"
        >
          <Avatar>
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal">
          <UserRound className="size-3.5" />
          {user.username}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void logout();
            onLogout?.();
          }}
        >
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

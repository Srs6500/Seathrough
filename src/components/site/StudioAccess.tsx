"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { GetStartedDialog } from "@/components/site/GetStartedDialog";
import { useQuestionAccess } from "@/components/usage/QuestionAccess";
import { useSmoothNavigate } from "@/lib/navigation/smoothNavigate";

type AuthMode = "login" | "signup";

type StudioAccessValue = {
  openStudio: (href: string) => void;
  openAuth: (mode?: AuthMode) => void;
  openGetStarted: () => void;
};

const StudioAccessContext = createContext<StudioAccessValue | null>(null);

/** Marketing helper: navigate into a workspace without forcing login. */
export function StudioAccessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useSmoothNavigate();
  const { openAuth } = useQuestionAccess();
  const [getStartedOpen, setGetStartedOpen] = useState(false);

  const openStudio = useCallback(
    (href: string) => {
      navigate(href);
    },
    [navigate],
  );

  const openGetStarted = useCallback(() => {
    setGetStartedOpen(true);
  }, []);

  const value = useMemo(
    () => ({ openStudio, openAuth, openGetStarted }),
    [openStudio, openAuth, openGetStarted],
  );

  return (
    <StudioAccessContext.Provider value={value}>
      {children}
      <GetStartedDialog
        open={getStartedOpen}
        onOpenChange={setGetStartedOpen}
        onPick={openStudio}
      />
    </StudioAccessContext.Provider>
  );
}

export function useStudioAccess(): StudioAccessValue {
  const ctx = useContext(StudioAccessContext);
  if (!ctx) {
    throw new Error("useStudioAccess must be used within StudioAccessProvider");
  }
  return ctx;
}

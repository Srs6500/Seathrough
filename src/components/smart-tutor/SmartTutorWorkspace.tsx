"use client";

import { useEffect } from "react";
import { VoiceTutorWorkspace } from "@/components/voice-tutor/VoiceTutorWorkspace";
import { smartTutorHref } from "@/lib/smart-tutor/tutorStyle";

export function SmartTutorWorkspace() {
  useEffect(() => {
    document.documentElement.classList.add("smart-tutor-page");
    const href = smartTutorHref();
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.replaceState(window.history.state, "", href);
    }
    return () => {
      document.documentElement.classList.remove("smart-tutor-page");
    };
  }, []);

  return <VoiceTutorWorkspace />;
}

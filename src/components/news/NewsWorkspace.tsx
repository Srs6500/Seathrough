"use client";

import { useEffect } from "react";
import { VoiceTutorWorkspace } from "@/components/voice-tutor/VoiceTutorWorkspace";

/** Smart-tutor lesson shell locked to news research + board style. */
export function NewsWorkspace() {
  useEffect(() => {
    document.documentElement.classList.add("smart-tutor-page");
    return () => {
      document.documentElement.classList.remove("smart-tutor-page");
    };
  }, []);

  return <VoiceTutorWorkspace style="news" />;
}

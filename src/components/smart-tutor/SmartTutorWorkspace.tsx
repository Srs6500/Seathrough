"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExperimentBoard } from "@/components/experiment/ExperimentBoard";
import { TutorStyleToggle } from "@/components/smart-tutor/TutorStyleToggle";
import { VoiceTutorWorkspace } from "@/components/voice-tutor/VoiceTutorWorkspace";
import {
  DEFAULT_TUTOR_STYLE,
  parseTutorStyle,
  readStoredTutorStyle,
  smartTutorHref,
  storeTutorStyle,
  type TutorStyle,
} from "@/lib/smart-tutor/tutorStyle";

function styleFromLocation(): TutorStyle | null {
  if (typeof window === "undefined") return null;
  return parseTutorStyle(
    new URLSearchParams(window.location.search).get("mode"),
  );
}

function writeStyleUrl(style: TutorStyle) {
  const href = smartTutorHref(style);
  if (`${window.location.pathname}${window.location.search}` === href) return;
  window.history.replaceState(window.history.state, "", href);
}

export function SmartTutorWorkspace() {
  const router = useRouter();
  const [style, setStyleState] = useState<TutorStyle>(DEFAULT_TUTOR_STYLE);
  const [ready, setReady] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("smart-tutor-page");
    return () => {
      document.documentElement.classList.remove("smart-tutor-page");
    };
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const fromUrl = styleFromLocation();
    const next = fromUrl ?? readStoredTutorStyle() ?? DEFAULT_TUTOR_STYLE;
    setStyleState(next);
    storeTutorStyle(next);
    writeStyleUrl(next);
    setReady(true);
  }, []);

  const setStyle = useCallback(
    (next: TutorStyle) => {
      setStyleState(next);
      storeTutorStyle(next);
      writeStyleUrl(next);
      router.replace(smartTutorHref(next));
    },
    [router],
  );

  const toggle = <TutorStyleToggle value={style} onChange={setStyle} />;

  if (!ready) {
    return <div className="fixed inset-0 bg-[#f4f4f6]" />;
  }

  if (style === "diagram") {
    return <ExperimentBoard kind="tutor" styleToggle={toggle} />;
  }

  if (style === "physics") {
    return <ExperimentBoard kind="physics" styleToggle={toggle} />;
  }

  return <VoiceTutorWorkspace styleToggle={toggle} />;
}

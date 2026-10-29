"use client";

import { Button, CopyButton, Text } from "@mantine/core";
import Link from "next/link";
import {
  cardRingStyle,
  featureStory,
  ringColor,
  statusPassed,
} from "@/lib/repo-scan/feature-testing";
import { featureDetailPath } from "@/lib/repo-scan/session";
import type { StoredFeature } from "@/lib/repo-scan/types";

export function FeatureNameCard({ feature }: { feature: StoredFeature }) {
  const ring = cardRingStyle(feature.verification_status);
  return (
    <Link
      href={featureDetailPath(feature.feature_id)}
      className="block h-full text-inherit no-underline"
    >
      <div
        className="flex min-h-16 h-full items-center rounded-xl px-4 py-3"
        style={{
          border: `2px solid ${ringColor(feature.verification_status)}`,
          backgroundColor: ring.backgroundColor,
        }}
      >
        <Text fw={600} size="sm" lh={1.4} c={ring.color}>
          {feature.name}
        </Text>
      </div>
    </Link>
  );
}

export function FeatureVerifyCard({ feature }: { feature: StoredFeature }) {
  const story = featureStory(feature);
  const ok = statusPassed(feature.verification_status);
  const extraProblems = story.problems.slice(1);
  const setupFix = Boolean(
    story.fix && /enter (a test login|the running app url)/i.test(story.fix),
  );

  return (
    <article className="flex flex-col gap-8">
      <div>
        <p
          className="text-[2rem] font-semibold tracking-tight"
          style={{ color: ringColor(feature.verification_status) }}
        >
          {story.verdict}
        </p>
        <p className="mt-3 max-w-[36rem] text-[1.05rem] leading-7 text-[#2c3d4a]">
          {story.whatHappened}
        </p>
      </div>

      {story.fix && !setupFix ? (
        <div>
          <p className="text-sm text-[#5a7388]">Paste this to your AI</p>
          <p className="mt-2 max-w-[36rem] text-[1.05rem] leading-7 text-[#17324a]">
            {story.fix}
          </p>
          <CopyButton value={story.fix}>
            {({ copied, copy }) => (
              <Button variant="light" size="sm" mt="md" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
        </div>
      ) : ok || setupFix ? null : (
        <p className="max-w-[36rem] text-sm leading-6 text-[#5a7388]">
          No suggested fix yet. Open the feature in your editor and ask your AI
          why this happens.
        </p>
      )}

      {extraProblems.length > 0 ? (
        <ul className="max-w-[36rem] list-none space-y-4 p-0">
          {extraProblems.map((problem) => (
            <li key={problem.id}>
              <p className="text-[0.95rem] font-medium text-[#9b2c2c]">
                {problem.name}
              </p>
              {problem.explanation ? (
                <p className="mt-1 text-sm leading-6 text-[#5a7388]">
                  {problem.explanation}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {story.passedCount > 0 && !ok ? (
        <p className="text-sm text-[#5a7388]">
          {story.passedCount === 1
            ? "1 other check passed."
            : `${story.passedCount} other checks passed.`}
        </p>
      ) : null}
    </article>
  );
}

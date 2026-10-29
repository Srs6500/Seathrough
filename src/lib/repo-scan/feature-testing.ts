import type {
  FeatureTestOrigin,
  FeatureTestResult,
  FeatureTestStatus,
  FeatureVerificationStatus,
  StoredFeature,
} from "@/lib/repo-scan/types";

export const FEATURE_STATUS_LABEL: Record<FeatureVerificationStatus, string> = {
  not_tested: "Not tested",
  passed: "Pass",
  failed: "Fail",
  inconclusive: "Inconclusive",
  blocked: "Blocked",
};

export const TEST_STATUS_LABEL: Record<FeatureTestStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  inconclusive: "Inconclusive",
  blocked: "Blocked",
};

export const TEST_METHOD_LABEL: Record<FeatureTestResult["type"], string> = {
  static: "Static",
  integration: "Integration",
  browser: "Browser",
  repo: "Repo",
};

export const TEST_ORIGIN_LABEL: Record<string, string> = {
  template: "Template",
  llm: "AI spec",
  repo: "Repo",
  static: "Static",
  mixed: "Mixed",
};

export function originLabel(
  origin: FeatureTestOrigin | "mixed" | null | undefined,
  type: FeatureTestResult["type"],
): string | null {
  if (origin && TEST_ORIGIN_LABEL[origin]) {
    if (type === "static" && origin === "template") {
      return null;
    }
    if (type === "repo") {
      return null;
    }
    return TEST_ORIGIN_LABEL[origin];
  }
  return null;
}

const STATUS_CLASS: Record<string, string> = {
  pass: "bg-[#e8f6ee] text-[#1f6b4a]",
  passed: "bg-[#e8f6ee] text-[#1f6b4a]",
  fail: "bg-[#fdecec] text-[#9b2c2c]",
  failed: "bg-[#fdecec] text-[#9b2c2c]",
  inconclusive: "bg-[#fff8eb] text-[#8a6d3b]",
  blocked: "bg-[#f4f8fb] text-[#5a7388]",
  not_tested: "bg-[#f4f8fb] text-[#7a93a8]",
};

export function statusClass(status: string): string {
  return STATUS_CLASS[status] ?? STATUS_CLASS.not_tested;
}

export function featurePassed(status: FeatureVerificationStatus): boolean {
  return status === "passed";
}

export function statusPassed(status: string): boolean {
  return status === "pass" || status === "passed";
}

export function ringColor(status: string): string {
  return statusPassed(status) ? "#2f9e6a" : "#d15a5a";
}

export function cardRingStyle(status: string): {
  border: string;
  backgroundColor: string;
  color: string;
} {
  if (statusPassed(status)) {
    return {
      border: "2px solid #2f9e6a",
      backgroundColor: "#f3faf6",
      color: "#1f6b4a",
    };
  }
  return {
    border: "2px solid #d15a5a",
    backgroundColor: "#fdf6f6",
    color: "#9b2c2c",
  };
}

export function featureCardBorder(status: FeatureVerificationStatus): string {
  return featurePassed(status)
    ? "border-[#2f9e6a] bg-[#f3faf6] text-[#1f6b4a]"
    : "border-[#d15a5a] bg-[#fdf6f6] text-[#9b2c2c]";
}

export const VIBE_STATUS_LABEL: Record<FeatureVerificationStatus, string> = {
  passed: "Works",
  failed: "Broken",
  blocked: "Couldn't test",
  inconclusive: "Not sure",
  not_tested: "Not tested",
};

const GENERIC_SUMMARIES = new Set([
  "Verification finished.",
  "This feature has not been verified yet.",
]);

export function brokenChecks(tests: FeatureTestResult[]): FeatureTestResult[] {
  return tests.filter((test) => test.status !== "pass");
}

export function featureStory(feature: StoredFeature): {
  verdict: string;
  whatHappened: string;
  fix: string | null;
  problems: FeatureTestResult[];
  passedCount: number;
} {
  const tests = feature.verification?.tests ?? [];
  const problems = brokenChecks(tests);
  const summary = feature.verification?.summary?.trim() || "";
  const firstProblem =
    problems[0]?.explanation?.trim() ||
    problems[0]?.name ||
    feature.verification?.failing_step?.trim() ||
    "";

  let whatHappened: string;
  if (feature.verification_status === "passed") {
    whatHappened = "This part of the app behaved the way it should.";
  } else if (summary && !GENERIC_SUMMARIES.has(summary)) {
    whatHappened = summary;
  } else if (firstProblem) {
    whatHappened = firstProblem;
  } else if (feature.verification_status === "blocked") {
    whatHappened = "The app could not be reached, so this was not tested.";
  } else if (feature.verification_status === "not_tested") {
    whatHappened = "This has not been tried yet.";
  } else {
    whatHappened = "Something did not work, but there is no extra detail.";
  }

  return {
    verdict: VIBE_STATUS_LABEL[feature.verification_status],
    whatHappened,
    fix: feature.verification?.suggested_fix?.trim() || null,
    problems,
    passedCount: tests.filter((test) => test.status === "pass").length,
  };
}

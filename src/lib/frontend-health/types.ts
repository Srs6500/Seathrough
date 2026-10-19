export type FindingSeverity = "error" | "warning" | "info";
export type FindingVerification = "confirmed" | "suspected" | "passed";

export type FrontendIssueType =
  | "runtime_error"
  | "failed_request"
  | "broken_navigation"
  | "form_validation"
  | "layout_overflow"
  | "accessibility";

export type ElementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FrontendFinding = {
  id: string;
  issue_type: FrontendIssueType;
  severity: FindingSeverity;
  title: string;
  summary: string;
  page: string;
  component?: string;
  element?: string;
  selector?: string;
  source_file?: string;
  source_line?: number;
  rect?: ElementRect;
  evidence: {
    action?: string;
    error?: string;
    request_status?: number | null;
    request_url?: string;
    notes?: string;
  };
  suggested_fix: string;
  verification: FindingVerification;
};

export type FrontendCheckSummary = {
  /** One of the six product categories, or a legacy/extra id. */
  id: string;
  label: string;
  status: "passed" | "failed" | "skipped";
};

export type FrontendScanResult = {
  targetUrl: string;
  title: string;
  /** Pixel size of the screenshot (full-page when live). */
  viewport: { width: number; height: number };
  screenshotBase64: string | null;
  /** True when the preview is a full-document capture, not just the first viewport. */
  screenshotFullPage?: boolean;
  /** Routes visited during the scan (live multi-page crawl). */
  pagesScanned?: string[];
  checksCompleted: number;
  checks: FrontendCheckSummary[];
  findings: FrontendFinding[];
  scannedAt: string;
  mode: "fixture" | "live";
};

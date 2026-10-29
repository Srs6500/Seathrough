export type VibeConfidence = "confirmed" | "needs_testing" | "unable";

export type VibeStepOrigin = "from_code" | "confirmed_by_test";

export type VibePage = {
  route: string;
  file: string;
  name: string;
};

export type VibeStep = {
  id: string;
  title: string;
  detail: string;
  file: string;
  functions: string[];
  route: string | null;
  role: string;
  origin: VibeStepOrigin;
  snippet: string;
};

export type VibeTestStatus = "pass" | "fail" | "needs_setup" | "not_sure";

export type VibeTest = {
  id: string;
  name: string;
  status: VibeTestStatus;
  detail: string;
};

export type VibeFeature = {
  id: string;
  name: string;
  description: string;
  entry_points: string[];
  status: string;
  steps: VibeStep[];
  tests: VibeTest[];
  simple: string;
};

export type VibeIssue = {
  id: string;
  feature_id: string;
  title: string;
  confidence: VibeConfidence;
  what: string;
  why: string;
  next: string;
  evidence: string[];
};

export type VibeGuide = {
  name: string;
  fullName: string | null;
  purpose: string;
  counts: {
    pages: number;
    features: number;
    issues: number;
    database: number;
  };
  pages: VibePage[];
  features: VibeFeature[];
  issues: VibeIssue[];
  tech: string[];
  database: string[];
  integrations: string[];
};

export type VibeAskResult = {
  answer: string;
  feature_id: string | null;
  files: string[];
};

export type VibeSandbox = {
  baseUrl: string;
  apiUrl: string;
  user: string;
  password: string;
};


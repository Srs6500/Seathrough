import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@excalidraw/excalidraw"],
  // Keep tesseract off the Turbopack graph — its worker_threads script
  // must load from a real filesystem path, not the virtual /ROOT remap.
  serverExternalPackages: [
    "tesseract.js",
    "tesseract.js-core",
    "playwright-core",
    "@browserbasehq/sdk",
    "speech-rule-engine",
    "temml",
  ],
  // Local datasets / Python backend must not be NFT-traced into every serverless function.
  outputFileTracingExcludes: {
    "*": [
      "./Analytics-Dashboard/**",
      "./metaphor-dataset/**",
      "./Physics-tutor-data/**",
      "./backend/**",
      "./browser-engine/**",
      "./.cache/**",
      "./tabler-icons/**",
    ],
  },
};

export default nextConfig;

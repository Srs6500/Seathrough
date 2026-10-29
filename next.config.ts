import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin Turbopack to this app — a parent ~/package-lock.json was stealing the root
  // and breaking client manifests (global-error / @swc/helpers).
  turbopack: {
    root: projectRoot,
  },
  images: {
    // 75 is the Next default; marketing screenshots request 92.
    qualities: [75, 92],
  },
  transpilePackages: ["@excalidraw/excalidraw", "@mantine/core", "@mantine/hooks"],
  // Keep tesseract off the Turbopack graph — its worker_threads script
  // must load from a real filesystem path, not the virtual /ROOT remap.
  serverExternalPackages: [
    "tesseract.js",
    "tesseract.js-core",
    "playwright-core",
    "@axe-core/playwright",
    "axe-core",
    "@browserbasehq/sdk",
    "speech-rule-engine",
    "temml",
    "onnxruntime-web",
    "@ricky0123/vad-web",
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

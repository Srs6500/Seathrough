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
  transpilePackages: ["@excalidraw/excalidraw"],
  // Keep tesseract off the Turbopack graph — its worker_threads script
  // must load from a real filesystem path, not the virtual /ROOT remap.
  // Do NOT put @seethrough/debug here: marking it external while also loading
  // it from instrumentation/routes corrupts the RSC client manifest under Turbopack.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
};

export default nextConfig;

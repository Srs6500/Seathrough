/**
 * Vercel / other serverless hosts cannot launch a local Chromium binary.
 * Railway is a long-running Docker container — Chromium is installed in the
 * Dockerfile and BROWSER_EXPERIENCE_PROVIDER=local is set there.
 */
export function isServerlessHost(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.FUNCTION_NAME ||
      process.env.NETLIFY,
  );
}

export function localPlaywrightAllowed(): boolean {
  return !isServerlessHost();
}

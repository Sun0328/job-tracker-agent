import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser tests build into .next-e2e (scripts/e2e/serve.ts), leaving a dev server's .next alone.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: {
    // The commit being built, inlined at build time and reported by /api/health. Workers Builds
    // sets WORKERS_CI_COMMIT_SHA; GitHub Actions sets GITHUB_SHA. The post-deploy check waits for it.
    BUILD_SHA: process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;

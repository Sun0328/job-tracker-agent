import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // The server side. Pages and components are covered by the browser tests in e2e/.
      include: ["src/{domain,data,services,agent,server}/**"],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      // A floor just under today's numbers: coverage may rise, a change that drops it fails CI.
      thresholds: { statements: 62, lines: 62, functions: 66, branches: 68 },
    },
  },
});

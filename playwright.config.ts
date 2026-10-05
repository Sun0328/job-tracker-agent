import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. Two suites:
 *
 *   smoke    read-only checks of a running demo. Runs against the local build in CI,
 *            and against the live Worker after every deploy (BASE_URL=https://...).
 *   journey  what an HR visitor does: analyse the example, download the letter,
 *            track it, change its status, get refused a second run. It writes, so it
 *            only ever runs against the local build (scripts/e2e/serve.ts).
 *
 *   npm run e2e                                    both, on a fresh local build
 *   BASE_URL=https://jobpilot-demo.fionasundev.workers.dev npm run e2e:smoke
 *
 * e2e/global-setup.ts refuses to start unless the target is a demo, and a local
 * target must be on the local database and storage with no model key.
 */

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || "http://localhost:3300";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One worker: the journey shares a database and the demo's per-network run limit.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  // No retries locally: a flaky test is a finding. One against the live site, for the network.
  retries: LOCAL ? 0 : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "smoke", testMatch: "smoke/**/*.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    ...(LOCAL
      ? [{
          name: "journey",
          testMatch: "journey/**/*.spec.ts",
          // The journey adds an application; the smoke suite counts the seed first.
          dependencies: ["smoke"],
          use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
        }]
      : []),
  ],
  webServer: LOCAL
    ? {
        command: "npm run e2e:serve",
        url: BASE_URL + "/api/health",
        timeout: 300_000,
        // Always a fresh build and seed, so the journey's one run is never already used.
        // E2E_REUSE=1 targets a server you started yourself (npm run e2e:serve -- --dev).
        reuseExistingServer: Boolean(process.env.E2E_REUSE),
        stdout: "pipe",
      }
    : undefined,
});

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag, option } from "@/cli/args";
import { localDemoEnv, seedLocalDemo } from "../demo/seed-local";

/**
 * The server the browser tests run against: a PRODUCTION build of the app (not
 * `next dev`) in demo mode, on a fresh copy of the demo seed, with no model key
 * (the agent's offline path) and no route to the real database, bucket or model.
 * Playwright starts it; it can also be run by hand.
 *
 *   npm run e2e:serve                  build, then serve on http://localhost:3300
 *   npm run e2e:serve -- --dev         next dev instead of a build, for writing tests
 *
 * It builds into .next-e2e, so a dev server using .next is left alone.
 */

const ROOT = process.cwd();
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

async function main() {
  const port = option("port") ?? "3300";
  const demo = await seedLocalDemo(ROOT, path.join(ROOT, "data", "e2e"));
  console.log("e2e database: " + demo.jobs + " fictional applications");

  // An empty key, not a missing one: Next loads .env only for variables that are not set at all.
  const env = localDemoEnv(demo, { DEEPSEEK_API_KEY: "", DEMO_SECRET: "e2e", NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" });

  const dev = flag("dev");
  if (!dev) {
    // next build points next-env.d.ts at its distDir. Put it back, so a test run leaves no diff.
    const nextEnv = path.join(ROOT, "next-env.d.ts");
    const original = readFileSync(nextEnv, "utf8");
    const build = spawnSync(process.execPath, [NEXT, "build"], { cwd: ROOT, env, stdio: "inherit" });
    writeFileSync(nextEnv, original);
    if (build.status !== 0) throw new Error("next build failed");
  }

  console.log("serving the e2e build on http://localhost:" + port);
  const child = spawn(process.execPath, [NEXT, dev ? "dev" : "start", "-p", port], { cwd: ROOT, env, stdio: "inherit" });
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error("e2e:serve failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});

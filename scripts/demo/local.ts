import { spawn } from "node:child_process";
import path from "node:path";
import { option } from "@/cli/args";
import { localDemoEnv, seedLocalDemo } from "./seed-local";

/**
 * The demo, on your machine, exactly as the public one: demo mode on, the
 * committed seed and files, a throwaway database in data/demo/local. Your real
 * database and bucket are not touched (the drivers are forced to local).
 *
 *   npm run demo:local                 http://localhost:3200
 *   npm run demo:local -- --port 3300
 */

const ROOT = process.cwd();

async function main() {
  const demo = await seedLocalDemo(ROOT, path.join(ROOT, "data", "demo", "local"));
  console.log("demo database: " + demo.jobs + " fictional applications, files copied to " + path.relative(ROOT, demo.bucket));
  const port = option("port") ?? "3200";

  console.log("starting the demo on http://localhost:" + port);
  const next = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [next, "dev", "-p", port], { cwd: ROOT, env: localDemoEnv(demo), stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error("demo:local failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});

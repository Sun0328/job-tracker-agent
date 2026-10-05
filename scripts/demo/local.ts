import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { option } from "@/cli/args";

/**
 * The demo, on your machine, exactly as the public one: demo mode on, the
 * committed seed and files, a throwaway database in data/demo/local. Your real
 * database and bucket are not touched (the drivers are forced to local).
 *
 *   npm run demo:local                 http://localhost:3200
 *   npm run demo:local -- --port 3300
 */

const ROOT = process.cwd();
const LOCAL = path.join(ROOT, "data", "demo", "local");
const DB_FILE = path.join(LOCAL, "jobpilot-demo.db");
const BUCKET = path.join(LOCAL, "bucket");

async function prepare() {
  rmSync(LOCAL, { recursive: true, force: true });
  mkdirSync(LOCAL, { recursive: true });
  process.env.JOB_DB = "local";
  process.env.LOCAL_DB_PATH = DB_FILE;

  const { getDb, splitStatements } = await import("@/infra/db");
  const db = await getDb();
  for (const file of readdirSync(path.join(ROOT, "db", "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of splitStatements(readFileSync(path.join(ROOT, "db", "migrations", file), "utf8"))) await db.run(statement);
  }
  const seed = path.join(ROOT, "demo", "seed.sql");
  if (!existsSync(seed)) throw new Error("demo/seed.sql is missing. Run `npm run demo:data` first.");
  for (const statement of splitStatements(readFileSync(seed, "utf8"))) await db.run(statement);
  const jobs = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM Job");
  await db.close();

  cpSync(path.join(ROOT, "demo", "bucket"), BUCKET, { recursive: true });
  console.log("demo database: " + jobs?.count + " fictional applications, files copied to " + path.relative(ROOT, BUCKET));
}

async function main() {
  await prepare();
  const port = option("port") ?? "3200";

  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(CLOUDFLARE_|R2_)/.test(key)) env[key] = value;
  }
  Object.assign(env, {
    DEMO_MODE: "1",
    DEMO_SECRET: "local-demo",
    JOB_DB: "local",
    LOCAL_DB_PATH: DB_FILE,
    FILE_STORAGE: "local",
    LOCAL_FILES_PATH: BUCKET,
  });

  console.log("starting the demo on http://localhost:" + port);
  const child = spawn("npx", ["next", "dev", "-p", port], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error("demo:local failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { flag } from "@/cli/args";

/**
 * Loads the committed demo data into the PUBLIC demo's own D1 database and R2
 * bucket (names in wrangler.jsonc): migrations, then demo/seed.sql (which
 * replaces every job, run and file row), then every object in demo/bucket/.
 * The DemoRun table is left alone, so one live run per visitor still holds.
 *
 * Runs on your machine (credentials from .env) and nightly in GitHub Actions
 * (credentials from repository secrets). Only CLOUDFLARE_ACCOUNT_ID and
 * CLOUDFLARE_API_TOKEN are passed to wrangler.
 *
 *   npm run demo:reset               migrations, data and files
 *   npm run demo:reset -- --data     migrations and data only (the nightly job)
 */

const ROOT = process.cwd();
const DATABASE = "jobpilot-demo";
const BUCKET = "jobpilot-demo-files";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function credentials(): NodeJS.ProcessEnv {
  const wanted = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"];
  const found: Record<string, string> = {};
  for (const key of wanted) if (process.env[key]) found[key] = process.env[key] as string;

  const envFile = path.join(ROOT, ".env");
  if (wanted.some((key) => !found[key]) && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match && wanted.includes(match[1]) && !found[match[1]]) found[match[1]] = match[2].trim();
    }
  }
  for (const key of wanted) if (!found[key]) throw new Error(key + " is not set (environment or .env).");

  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(CLOUDFLARE_|R2_|DEEPSEEK_|JOB_DB|FILE_STORAGE)/.test(key)) env[key] = value;
  }
  return { ...env, ...found };
}

/** Wrangler's own entry point, run by this Node with no shell, so arguments such as "text/markdown; charset=utf-8" pass through intact. */
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error("wrangler " + args.slice(0, 3).join(" ") + " failed with exit code " + result.status);
}

function bucketFiles(directory: string, prefix = ""): Array<{ key: string; file: string }> {
  const files: Array<{ key: string; file: string }> = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    const key = prefix ? prefix + "/" + name : name;
    if (statSync(full).isDirectory()) files.push(...bucketFiles(full, key));
    else files.push({ key, file: full });
  }
  return files;
}

function main() {
  const env = credentials();
  const seed = path.join(ROOT, "demo", "seed.sql");
  if (!existsSync(seed)) throw new Error("demo/seed.sql is missing. Run `npm run demo:data` first.");

  console.log("1/3 migrations on " + DATABASE);
  wrangler(["d1", "migrations", "apply", DATABASE, "--remote"], env);

  console.log("2/3 demo data into " + DATABASE);
  wrangler(["d1", "execute", DATABASE, "--remote", "--yes", "--file=" + seed], env);

  if (flag("data")) {
    console.log("files skipped (--data)");
    return;
  }

  const files = bucketFiles(path.join(ROOT, "demo", "bucket"));
  console.log("3/3 " + files.length + " files into " + BUCKET);
  for (const { key, file } of files) {
    const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    wrangler(["r2", "object", "put", BUCKET + "/" + key, "--file=" + file, "--remote", "--content-type=" + contentType], env);
  }
  console.log("demo reset done");
}

try {
  main();
} catch (error) {
  console.error("\ndemo reset failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

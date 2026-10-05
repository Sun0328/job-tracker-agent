import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { flag } from "@/cli/args";

/**
 * Builds and deploys the PUBLIC demo Worker from a clean room.
 *
 * Why a clean room: the Cloudflare adapter reads every .env file in the project
 * at build time and embeds the values in the Worker, and Next.js copies .env
 * into the server bundle. Building in place would ship your real Cloudflare
 * token, DeepSeek key and R2 keys, and point the demo at your real database.
 *
 * So the build runs in data/demo/build, a copy of the tracked (and untracked,
 * not ignored) files only. Ignored files (.env, data/candidate.json, your CVs)
 * never get there. Before deploying, the output is scanned for every secret
 * value in your .env, and the deploy is refused if any is found.
 *
 *   npm run demo:deploy              build, scan, deploy
 *   npm run demo:deploy -- --build   build and scan only
 */

const ROOT = process.cwd();
const WORK = path.join(ROOT, "data", "demo", "build");

/** Env vars the build and deploy must not see. Wrangler gets only the two it needs, explicitly. */
const SCRUB = /^(CLOUDFLARE_|DEEPSEEK_|R2_|TYPESAFE_|GOOGLE_SEARCH_|TAVILY_|BRAVE_|JOB_DB|FILE_STORAGE|LOCAL_|RESUME_PREFIX|DEMO_)/;

function scrubbedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) if (!SCRUB.test(key)) env[key] = value;
  return { ...env, ...extra };
}

const PUBLIC_KEYS = /(_BASE_URL|_MODEL|^R2_BUCKET|^JOB_DB|^FILE_STORAGE)$/;

/** Values from your local env files that must never appear in a build. */
function secretValues(): string[] {
  const values = new Set<string>();
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      const value = match?.[2]?.trim().replace(/^["']|["']$/g, "");
      // Public settings (base URLs, model ids, bucket names) also appear in the source as defaults.
      if (!match || PUBLIC_KEYS.test(match[1])) continue;
      // Short values (driver names, flags) are not secrets and would match innocently.
      if (value && value.length >= 16) values.add(value);
    }
  }
  return [...values];
}

function walk(directory: string, visit: (file: string) => void) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  // A shell only for npm/npx (.cmd files on Windows); node itself runs without one.
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" && command !== process.execPath });
  if (result.status !== 0) throw new Error(command + " " + args.join(" ") + " failed with exit code " + result.status);
}

function prepareCleanRoom() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

  let copied = 0;
  for (const file of listed) {
    if (/(^|\/)\.env(\.|$)/.test(file)) continue;
    const source = path.join(ROOT, file);
    if (!existsSync(source) || !statSync(source).isFile()) continue;
    const target = path.join(WORK, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target);
    copied += 1;
  }
  // A real install from the lockfile. A junction to the project's node_modules
  // makes Next's file tracing try to create symlinks, which Windows refuses.
  run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], WORK, scrubbedEnv());

  const envFiles: string[] = [];
  walk(WORK, (file) => {
    if (/(^|[\\/])\.env/.test(path.relative(WORK, file))) envFiles.push(file);
  });
  if (envFiles.length) throw new Error("Refusing to build: env files in the clean room: " + envFiles.join(", "));
  console.log("clean room: " + copied + " files copied to " + path.relative(ROOT, WORK) + ", no .env files");
}

function scanForSecrets() {
  const secrets = secretValues();
  const leaks: string[] = [];
  walk(path.join(WORK, ".open-next"), (file) => {
    if (statSync(file).size > 50 * 1024 * 1024) return;
    const text = readFileSync(file, "latin1");
    if (secrets.some((secret) => text.includes(secret))) leaks.push(path.relative(WORK, file));
  });
  if (leaks.length) throw new Error("Refusing to deploy: a value from your .env is in the build output: " + leaks.join(", "));
  console.log("secret scan: " + secrets.length + " values from your .env checked, none in the build output");
}

function readEnvFile(): Record<string, string> {
  const values: Record<string, string> = {};
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

/**
 * Credentials for `wrangler deploy` only. CLOUDFLARE_DEPLOY_TOKEN, when set, is a
 * token with Workers permission kept apart from the D1/R2 token the app uses.
 */
function deployEnv(): NodeJS.ProcessEnv {
  const local = readEnvFile();
  const token = local.CLOUDFLARE_DEPLOY_TOKEN || local.CLOUDFLARE_API_TOKEN;
  if (!local.CLOUDFLARE_ACCOUNT_ID || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID and a deploy token are needed in .env.");
  return scrubbedEnv({ CLOUDFLARE_ACCOUNT_ID: local.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: token });
}

/** The salt for hashing visitors' IPs. Generated once, kept outside git, reused on every deploy. */
function demoSecret(): string {
  const file = path.join(ROOT, "data", "demo", "demo-secret.txt");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, secret, "utf8");
  return secret;
}

/** Point the README's live-demo link at the deployed Worker. */
function recordUrl(output: string) {
  const url = /https:\/\/jobpilot-demo\.[a-z0-9-]+\.workers\.dev/.exec(output)?.[0];
  if (!url) return;
  const readme = path.join(ROOT, "README.md");
  const text = readFileSync(readme, "utf8");
  const updated = text.replace(
    /(<!-- live-demo[^>]*-->\r?\n)[\s\S]*?(\r?\n<!-- \/live-demo -->)/,
    "$1**[Live demo](" + url + ")**: a fictional candidate and fictional companies, with one live AI run per visitor.$2",
  );
  if (updated !== text) writeFileSync(readme, updated, "utf8");
  console.log("\nlive demo: " + url + (updated !== text ? " (README updated)" : ""));
}

function deploy() {
  const deepseek = readEnvFile().DEEPSEEK_API_KEY;
  if (!deepseek) throw new Error("DEEPSEEK_API_KEY is empty: the demo's one live run needs it.");

  // Secrets go up with the Worker, so it is never live without its key. The file is
  // outside the project and deleted straight after.
  const secretsFile = path.join(tmpdir(), "jobpilot-demo-secrets-" + process.pid + ".json");
  writeFileSync(secretsFile, JSON.stringify({ DEEPSEEK_API_KEY: deepseek, DEMO_SECRET: demoSecret() }), { encoding: "utf8", mode: 0o600 });
  try {
    const wranglerJs = path.join(WORK, "node_modules", "wrangler", "bin", "wrangler.js");
    const result = spawnSync(process.execPath, [wranglerJs, "deploy", "--secrets-file", secretsFile], {
      cwd: WORK,
      env: deployEnv(),
      encoding: "utf8",
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.status !== 0) {
      const denied = /No access to the specified resource|Authentication error|code: 10000/.test((result.stdout ?? "") + (result.stderr ?? ""));
      throw new Error(denied
        ? "Cloudflare refused the deploy: the token has no Workers permission. Add 'Account > Workers Scripts > Edit' to it, or put a token from the 'Edit Cloudflare Workers' template in .env as CLOUDFLARE_DEPLOY_TOKEN."
        : "wrangler deploy failed with exit code " + result.status);
    }
    recordUrl(result.stdout ?? "");
  } finally {
    rmSync(secretsFile, { force: true });
  }
}

function main() {
  prepareCleanRoom();
  run("npx", ["opennextjs-cloudflare", "build"], WORK, scrubbedEnv({ NEXT_TELEMETRY_DISABLED: "1" }));
  scanForSecrets();
  if (flag("build")) {
    console.log("built and scanned; not deployed (--build)");
    return;
  }
  deploy();
}

try {
  main();
} catch (error) {
  console.error("\ndemo deploy failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

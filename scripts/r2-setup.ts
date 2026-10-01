import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv, option } from "@/cli/args";
import { createR2Storage, readR2Config } from "@/infra/storage/r2";

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_BUCKET = "jobpilot-files";

interface Envelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API_BASE + url, {
    ...init,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.map((error) => "[" + (error.code ?? "?") + "] " + error.message).join("; ");
    throw new Error("Cloudflare API " + response.status + ": " + (detail || "unknown error") + " (" + url + ")");
  }
  return payload.result as T;
}

async function setEnvValue(key: string, value: string) {
  const file = path.join(process.cwd(), ".env");
  const current = await readFile(file, "utf8").catch(() => "");
  const lines = current.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(key + "="));
  if (index >= 0) lines[index] = key + "=" + value;
  else lines.push(key + "=" + value);
  await writeFile(file, lines.join("\n"), "utf8");
}

async function main() {
  loadEnv();

  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const bucket = option("bucket") ?? process.env.R2_BUCKET?.trim() ?? DEFAULT_BUCKET;

  if (token && accountId) {
    const existing = await call<{ buckets?: Array<{ name: string }> }>(token, "/accounts/" + accountId + "/r2/buckets");
    const found = existing.buckets?.some((item) => item.name === bucket);

    if (found) {
      console.log("bucket: " + bucket + " already exists");
    } else {
      await call(token, "/accounts/" + accountId + "/r2/buckets", {
        method: "POST",
        body: JSON.stringify({ name: bucket, locationHint: option("location") ?? "apac" }),
      });
      console.log("bucket: created " + bucket);
    }
    await setEnvValue("R2_BUCKET", bucket);
  } else {
    console.log("No CLOUDFLARE_API_TOKEN/ACCOUNT_ID — skipping bucket creation, checking access only.");
  }

  if (!readR2Config()) {
    console.log(
      [
        "",
        "R2 object access still needs an S3 key pair (separate from the account API token):",
        "  Cloudflare dashboard -> R2 -> API -> Manage API tokens -> Create API token",
        "  Permission: Object Read & Write, scoped to the " + bucket + " bucket",
        "",
        "Put the pair in .env:",
        "  R2_ACCESS_KEY_ID=...",
        "  R2_SECRET_ACCESS_KEY=...",
        "  R2_BUCKET=" + bucket,
        "  FILE_STORAGE=r2",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  // Round trip a throwaway object so a broken key pair fails here, not mid-application.
  const storage = createR2Storage();
  const key = "_healthcheck/" + Date.now() + ".txt";
  const body = new TextEncoder().encode("jobpilot r2 check");

  const put = await storage.put(key, body, "text/plain");
  const got = await storage.get(key);
  const deleted = await storage.delete(key);

  if (!got || new TextDecoder().decode(got.body) !== "jobpilot r2 check") {
    throw new Error("Round trip failed: object did not read back correctly");
  }

  await setEnvValue("FILE_STORAGE", "r2");
  console.log("round trip ok: put " + put.size + " bytes, read back, deleted=" + deleted);
  console.log(".env updated: FILE_STORAGE=r2, R2_BUCKET=" + bucket);
}

main().catch((error) => {
  console.error("\nR2 setup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

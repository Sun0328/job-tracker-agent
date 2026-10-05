import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv, option } from "@/cli/args";

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_NAME = "jobpilot";

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API_BASE + url, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  const payload = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null;
  if (!response.ok || !payload?.success) {
    const detail = payload?.errors?.map((error) => "[" + (error.code ?? "?") + "] " + error.message).join("; ");
    throw new Error("Cloudflare API " + response.status + ": " + (detail || "unknown error") + " (" + url + ")");
  }
  return payload.result as T;
}

/** Replace a KEY=value line in .env without touching anything else in the file. */
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
  if (!token) {
    console.error(
      [
        "CLOUDFLARE_API_TOKEN is empty.",
        "",
        "Create one at https://dash.cloudflare.com/profile/api-tokens",
        "  Create Token -> Custom token",
        "  Permissions: Account -> D1 -> Edit",
        "  Account Resources: your account",
        "",
        "Then put it in .env as CLOUDFLARE_API_TOKEN=... and run this again.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const name = option("name") ?? DEFAULT_NAME;

  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) {
    const accounts = await call<Array<{ id: string; name: string }>>(token, "/accounts");
    if (!accounts.length) throw new Error("This token cannot see any Cloudflare account.");
    if (accounts.length > 1) {
      console.log("Several accounts are visible:");
      for (const account of accounts) console.log("  " + account.id + "  " + account.name);
      throw new Error("Set CLOUDFLARE_ACCOUNT_ID in .env to the one you want.");
    }
    accountId = accounts[0].id;
    console.log("account: " + accounts[0].name + " (" + accountId + ")");
    await setEnvValue("CLOUDFLARE_ACCOUNT_ID", accountId);
  } else {
    console.log("account: " + accountId);
  }

  const existing = await call<Array<{ uuid: string; name: string }>>(token, "/accounts/" + accountId + "/d1/database");
  let database = existing.find((item) => item.name === name);

  if (database) {
    console.log("database: " + name + " already exists (" + database.uuid + ")");
  } else {
    const created = await call<{ uuid: string; name: string }>(token, "/accounts/" + accountId + "/d1/database", {
      method: "POST",
      body: JSON.stringify({ name, primary_location_hint: option("location") ?? "oc" }),
    });
    database = { uuid: created.uuid, name: created.name };
    console.log("database: created " + name + " (" + database.uuid + ")");
  }

  await setEnvValue("CLOUDFLARE_D1_DATABASE_ID", database.uuid);
  await setEnvValue("JOB_DB", "d1");

  const tomlPath = path.join(process.cwd(), "wrangler.real.toml");
  const toml = await readFile(tomlPath, "utf8").catch(() => "");
  if (toml.includes("REPLACE_AFTER_D1_CREATE")) {
    await writeFile(tomlPath, toml.replace("REPLACE_AFTER_D1_CREATE", database.uuid), "utf8");
    console.log("wrangler.real.toml: database_id filled in");
  }

  console.log("\n.env updated: JOB_DB=d1, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID");
  console.log("next: pnpm db:migrate");
}

main().catch((error) => {
  console.error("\nD1 setup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

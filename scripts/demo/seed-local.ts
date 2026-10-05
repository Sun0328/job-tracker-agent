import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * A throwaway copy of the public demo on disk: a SQLite database with every
 * migration and demo/seed.sql applied, and demo/bucket copied beside it. Used by
 * `npm run demo:local` and by the browser tests, so both run against exactly
 * what the live demo is reset to.
 */

export interface LocalDemo {
  dbFile: string;
  bucket: string;
  jobs: number;
}

export async function seedLocalDemo(root: string, directory: string): Promise<LocalDemo> {
  const dbFile = path.join(directory, "jobpilot-demo.db");
  const bucket = path.join(directory, "bucket");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const seed = path.join(root, "demo", "seed.sql");
  if (!existsSync(seed)) throw new Error("demo/seed.sql is missing. Run `npm run demo:data` first.");

  const { createLocalSqliteExecutor } = await import("@/infra/db/local-sqlite");
  const { splitStatements } = await import("@/infra/db");
  const db = await createLocalSqliteExecutor(dbFile);
  try {
    const migrations = path.join(root, "db", "migrations");
    for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
      for (const statement of splitStatements(readFileSync(path.join(migrations, file), "utf8"))) await db.run(statement);
    }
    for (const statement of splitStatements(readFileSync(seed, "utf8"))) await db.run(statement);
    const jobs = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM Job");
    cpSync(path.join(root, "demo", "bucket"), bucket, { recursive: true });
    return { dbFile, bucket, jobs: Number(jobs?.count ?? 0) };
  } finally {
    await db.close();
  }
}

/**
 * The environment for a local demo server: demo mode on, both drivers forced to
 * local, and nothing that could reach the real database, bucket or model.
 */
export function localDemoEnv(demo: LocalDemo, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(CLOUDFLARE_|R2_|DEMO_|JOB_DB|FILE_STORAGE|LOCAL_)/.test(key)) env[key] = value;
  }
  return Object.assign(env, {
    DEMO_MODE: "1",
    DEMO_SECRET: "local-demo",
    JOB_DB: "local",
    LOCAL_DB_PATH: demo.dbFile,
    FILE_STORAGE: "local",
    LOCAL_FILES_PATH: demo.bucket,
    ...extra,
  });
}

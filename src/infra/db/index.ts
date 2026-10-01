import { createD1HttpExecutor, readD1Config } from "@/infra/db/d1-http";
import { createLocalSqliteExecutor } from "@/infra/db/local-sqlite";
import type { SqlExecutor } from "@/infra/db/executor";

export type { Row, SqlExecutor, SqlValue } from "@/infra/db/executor";
export { splitStatements } from "@/infra/db/executor";
export { D1_MAX_BOUND_PARAMS } from "@/infra/db/d1-http";

let cached: Promise<SqlExecutor> | null = null;

/** `d1` for the real Cloudflare database, `local` for the on-disk SQLite file. */
export function selectedDriver(): "d1" | "local" {
  const configured = process.env.JOB_DB?.toLowerCase();
  if (configured === "d1" || configured === "local") return configured;
  return readD1Config() ? "d1" : "local";
}

export function getDb(): Promise<SqlExecutor> {
  if (!cached) {
    cached = selectedDriver() === "d1"
      ? Promise.resolve(createD1HttpExecutor())
      : createLocalSqliteExecutor();
  }
  return cached;
}

/** Tests and CLI scripts use this to point the process at a throwaway database. */
export function setDb(executor: SqlExecutor | null) {
  cached = executor ? Promise.resolve(executor) : null;
}

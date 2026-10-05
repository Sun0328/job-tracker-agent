import { createD1BindingExecutor } from "@/infra/db/d1-binding";
import { createD1HttpExecutor, readD1Config } from "@/infra/db/d1-http";
import { createLocalSqliteExecutor } from "@/infra/db/local-sqlite";
import type { SqlExecutor } from "@/infra/db/executor";

export type { Row, SqlExecutor, SqlValue } from "@/infra/db/executor";
export { splitStatements } from "@/infra/db/executor";
export { D1_MAX_BOUND_PARAMS } from "@/infra/db/d1-http";

export type DbDriver = "d1" | "d1-binding" | "local";

let cached: Promise<SqlExecutor> | null = null;

/**
 * `d1` for Cloudflare D1 over the HTTP API (your machine, the CLI),
 * `d1-binding` for D1 through a Worker binding (the deployed demo),
 * `local` for the on-disk SQLite file.
 */
export function selectedDriver(): DbDriver {
  const configured = process.env.JOB_DB?.toLowerCase();
  if (configured === "d1" || configured === "d1-binding" || configured === "local") return configured;
  return readD1Config() ? "d1" : "local";
}

export function getDb(): Promise<SqlExecutor> {
  if (!cached) {
    const driver = selectedDriver();
    cached = driver === "d1"
      ? Promise.resolve(createD1HttpExecutor())
      : driver === "d1-binding"
        ? Promise.resolve(createD1BindingExecutor())
        : createLocalSqliteExecutor();
  }
  return cached;
}

/** Tests and CLI scripts use this to point the process at a throwaway database. */
export function setDb(executor: SqlExecutor | null) {
  cached = executor ? Promise.resolve(executor) : null;
}

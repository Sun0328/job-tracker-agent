import path from "node:path";
import { mkdirSync } from "node:fs";
import { splitStatements, type Row, type SqlExecutor, type SqlValue } from "@/infra/db/executor";

type Statement = {
  all: (...params: SqlValue[]) => Row[];
  run: (...params: SqlValue[]) => { changes: number | bigint };
};
type Database = {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => void;
  close: () => void;
};

export const DEFAULT_LOCAL_DB = path.join(process.cwd(), "data", "jobpilot.db");

/**
 * node:sqlite keeps the local driver dependency-free. It is imported lazily so
 * bundlers never pull it into a Cloudflare/edge build that only uses D1 HTTP.
 */
/**
 * Node hides experimental modules from module.builtinModules, so an ordinary
 * import of "node:sqlite" makes bundlers (Vite, webpack) look for it on disk and
 * fail. process.getBuiltinModule reaches the builtin with nothing for a bundler
 * to rewrite.
 */
function loadSqlite(): { DatabaseSync: new (location: string) => Database } {
  const getBuiltinModule = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    throw new Error("The local SQLite driver needs Node 22.14 or newer. Use JOB_DB=d1 or upgrade Node.");
  }
  const sqlite = getBuiltinModule.call(process, "node:sqlite") as { DatabaseSync: new (location: string) => Database } | undefined;
  if (!sqlite?.DatabaseSync) throw new Error("node:sqlite is not available in this Node build.");
  return sqlite;
}

export async function createLocalSqliteExecutor(file = process.env.LOCAL_DB_PATH || DEFAULT_LOCAL_DB): Promise<SqlExecutor> {
  const { DatabaseSync } = loadSqlite();

  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");

  const normalise = (rows: Row[]) => rows.map((row) => ({ ...row }));

  return {
    driver: "local-sqlite",
    async all<T extends Row = Row>(sql: string, params: SqlValue[] = []) {
      return normalise(db.prepare(sql).all(...params)) as T[];
    },
    async first<T extends Row = Row>(sql: string, params: SqlValue[] = []) {
      return (normalise(db.prepare(sql).all(...params))[0] ?? null) as T | null;
    },
    async run(sql: string, params: SqlValue[] = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes ?? 0) };
    },
    async script(sql: string) {
      return splitStatements(sql).map((statement) => normalise(db.prepare(statement).all()));
    },
    async close() {
      db.close();
    },
  };
}

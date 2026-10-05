import { cloudflareBindings, type D1DatabaseLike } from "@/infra/cloudflare";
import { splitStatements, type Row, type SqlExecutor, type SqlValue } from "@/infra/db/executor";

/**
 * D1 through the Worker's own binding. Same SQL as the HTTP driver, but no API
 * token: the deployed demo cannot reach any database except the one it is bound to.
 */
export function createD1BindingExecutor(): SqlExecutor {
  const database = async (): Promise<D1DatabaseLike> => {
    const db = (await cloudflareBindings()).DB;
    if (!db) throw new Error("JOB_DB=d1-binding, but this Worker has no DB binding (see wrangler.jsonc).");
    return db;
  };

  return {
    driver: "d1-binding",
    async all<T extends Row = Row>(sql: string, params: SqlValue[] = []) {
      const result = await (await database()).prepare(sql).bind(...params).all<T>();
      return result.results ?? [];
    },
    async first<T extends Row = Row>(sql: string, params: SqlValue[] = []) {
      const result = await (await database()).prepare(sql).bind(...params).all<T>();
      return result.results?.[0] ?? null;
    },
    async run(sql: string, params: SqlValue[] = []) {
      const result = await (await database()).prepare(sql).bind(...params).run();
      return { changes: result.meta?.changes ?? 0 };
    },
    async script(sql: string) {
      const db = await database();
      const results = await db.batch(splitStatements(sql).map((statement) => db.prepare(statement)));
      return results.map((result) => (result.results ?? []) as Row[]);
    },
    async close() {
      /* The binding belongs to the Worker; there is nothing to close. */
    },
  };
}

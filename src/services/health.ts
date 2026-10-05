import { getDb, selectedDriver, type DbDriver } from "@/infra/db";
import { deepSeekConfigured, deepSeekModel } from "@/infra/llm/deepseek";
import { getFileStorage, selectedFileDriver, type FileDriver } from "@/infra/storage";

export interface Health {
  ok: boolean;
  driver: DbDriver;
  database: { ok: boolean; jobs?: number; runs?: number; error?: string };
  files: { driver: FileDriver; ok: boolean; error?: string };
  agent: { mode: "deepseek" | "demo"; model: string | null };
  /** The commit this build was made from (set by next.config.ts), so a deploy can be checked. Null locally. */
  version: string | null;
}

/** Cheap check that the database and storage are reachable and which models are wired up. */
export async function getHealth(): Promise<Health> {
  let database: Health["database"];
  try {
    const db = await getDb();
    const jobs = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM Job WHERE bDelete = 0");
    const runs = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM AgentRun");
    database = { ok: true, jobs: Number(jobs?.count ?? 0), runs: Number(runs?.count ?? 0) };
  } catch (error) {
    database = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  let storage: { ok: boolean; error?: string };
  try {
    await getFileStorage().list("", 1);
    storage = { ok: true };
  } catch (error) {
    storage = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: database.ok,
    driver: selectedDriver(),
    database,
    files: { driver: selectedFileDriver(), ...storage },
    agent: { mode: deepSeekConfigured() ? "deepseek" : "demo", model: deepSeekConfigured() ? deepSeekModel() : null },
    version: process.env.BUILD_SHA || null,
  };
}

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createLocalSqliteExecutor } from "@/infra/db/local-sqlite";
import { setDb, splitStatements, type SqlExecutor } from "@/infra/db";
import type { ExtractedJob } from "@/domain";

/** A throwaway in-memory database with every migration applied. */
export async function freshDb(): Promise<SqlExecutor> {
  const db = await createLocalSqliteExecutor(":memory:");
  const directory = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    for (const statement of splitStatements(sql)) await db.run(statement);
  }
  setDb(db);
  return db;
}

export async function closeDb(db: SqlExecutor) {
  setDb(null);
  await db.close();
}

export function daysAgo(days: number, hour = 9): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

export const sampleJob: ExtractedJob = {
  sCompany: "Halter",
  bAgency: false,
  sCompanyMeta: { industry: "Agritech", business: "Virtual fencing.", website_url: "https://halterhq.com" },
  sJobTitle: "QA Automation Engineer",
  sJobRequirement: "- 3 years automation",
  sContractType: "Permanent",
  sLocation: "Auckland",
  sJobSummary: "Own the automated test strategy.",
  sSource: "SEEK",
  sSourceUrl: null,
  sTechStack: ["TypeScript", "Playwright"],
};

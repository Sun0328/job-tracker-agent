import { getDb } from "@/infra/db";

export interface DemoLimits {
  /** Live analyses one visitor (one cookie) may ever run. */
  perVisitor: number;
  /** Per IP address per UTC day, so clearing cookies buys little. */
  perIpPerDay: number;
  /** Across all visitors per UTC day: the ceiling on the DeepSeek bill. */
  perDay: number;
}

export type DemoRefusal = "visitor" | "ip" | "daily";

export type DemoClaim = { granted: true; iID: number } | { granted: false; reason: DemoRefusal };

/** Midnight UTC today, as the ISO prefix every dtDateTime shares. */
export function startOfUtcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10) + "T00:00:00.000Z";
}

/**
 * Take one run if every limit allows it. The check and the insert are one
 * statement, so two clicks at the same moment cannot both get through.
 */
export async function claimDemoRun(sVisitor: string, sIpHash: string, limits: DemoLimits, now: Date = new Date()): Promise<DemoClaim> {
  const db = await getDb();
  const today = startOfUtcDay(now);

  const inserted = await db.all<{ iID: number }>(
    `INSERT INTO DemoRun (sVisitor, sIpHash, dtDateTime)
     SELECT ?, ?, ?
     WHERE (SELECT COUNT(*) FROM DemoRun WHERE sVisitor = ?) < ?
       AND (SELECT COUNT(*) FROM DemoRun WHERE sIpHash = ? AND dtDateTime >= ?) < ?
       AND (SELECT COUNT(*) FROM DemoRun WHERE dtDateTime >= ?) < ?
     RETURNING iID`,
    [sVisitor, sIpHash, now.toISOString(), sVisitor, limits.perVisitor, sIpHash, today, limits.perIpPerDay, today, limits.perDay],
  );
  if (inserted[0]?.iID != null) return { granted: true, iID: Number(inserted[0].iID) };

  // Refused: say which limit, so the message can be honest about it.
  const usage = await demoUsage(sVisitor, sIpHash, now);
  const reason: DemoRefusal = usage.visitor >= limits.perVisitor ? "visitor" : usage.ip >= limits.perIpPerDay ? "ip" : "daily";
  return { granted: false, reason };
}

/** Give a run back, when it never got to do its work (the model or the network failed). */
export async function releaseDemoRun(iID: number): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM DemoRun WHERE iID = ?", [iID]);
}

export interface DemoUsage {
  visitor: number;
  ip: number;
  today: number;
}

export async function demoUsage(sVisitor: string, sIpHash: string, now: Date = new Date()): Promise<DemoUsage> {
  const db = await getDb();
  const today = startOfUtcDay(now);
  const row = await db.first<{ visitor: number; ip: number; today: number }>(
    `SELECT
       (SELECT COUNT(*) FROM DemoRun WHERE sVisitor = ?) AS visitor,
       (SELECT COUNT(*) FROM DemoRun WHERE sIpHash = ? AND dtDateTime >= ?) AS ip,
       (SELECT COUNT(*) FROM DemoRun WHERE dtDateTime >= ?) AS today`,
    [sVisitor, sIpHash, today, today],
  );
  return { visitor: Number(row?.visitor ?? 0), ip: Number(row?.ip ?? 0), today: Number(row?.today ?? 0) };
}

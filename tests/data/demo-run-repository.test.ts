import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, freshDb } from "../helpers";
import { claimDemoRun, demoUsage, releaseDemoRun, startOfUtcDay } from "@/data/demo-run-repository";
import type { SqlExecutor } from "@/infra/db";

let db: SqlExecutor;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDb(db);
});

const limits = { perVisitor: 1, perIpPerDay: 3, perDay: 5 };
const at = (iso: string) => new Date(iso);

describe("demo run limits", () => {
  it("gives a visitor one run, then names why the second is refused", async () => {
    const first = await claimDemoRun("visitor-a", "ip-1", limits);
    expect(first.granted).toBe(true);

    const second = await claimDemoRun("visitor-a", "ip-1", limits);
    expect(second).toEqual({ granted: false, reason: "visitor" });
    expect((await demoUsage("visitor-a", "ip-1")).visitor).toBe(1);
  });

  it("caps one network per day, so clearing cookies buys little", async () => {
    for (const visitor of ["a", "b", "c"]) expect((await claimDemoRun(visitor, "ip-1", limits)).granted).toBe(true);
    expect(await claimDemoRun("d", "ip-1", limits)).toEqual({ granted: false, reason: "ip" });
    expect((await claimDemoRun("d", "ip-2", limits)).granted).toBe(true);
  });

  it("caps everyone per day, and the caps reset at midnight UTC", async () => {
    const day = at("2026-10-05T10:00:00.000Z");
    for (const [index, visitor] of ["a", "b", "c", "d", "e"].entries()) {
      expect((await claimDemoRun(visitor, "ip-" + index, limits, day)).granted).toBe(true);
    }
    expect(await claimDemoRun("f", "ip-9", limits, day)).toEqual({ granted: false, reason: "daily" });

    const tomorrow = at("2026-10-06T00:00:01.000Z");
    expect(startOfUtcDay(tomorrow)).toBe("2026-10-06T00:00:00.000Z");
    expect((await claimDemoRun("f", "ip-9", limits, tomorrow)).granted).toBe(true);
    // The per-visitor limit does not reset: one run each, ever.
    expect(await claimDemoRun("a", "ip-0", limits, tomorrow)).toEqual({ granted: false, reason: "visitor" });
  });

  it("gives a run back when it never did its work", async () => {
    const claim = await claimDemoRun("visitor-a", "ip-1", limits);
    if (!claim.granted) throw new Error("expected the first claim to be granted");
    await releaseDemoRun(claim.iID);
    expect((await claimDemoRun("visitor-a", "ip-1", limits)).granted).toBe(true);
  });
});

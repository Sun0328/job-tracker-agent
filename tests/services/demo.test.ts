import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, freshDb } from "../helpers";
import { prepareAnalysis, type AnalyseRequest } from "@/services/analyse-job";
import { DemoBlockedError, demoLimits, demoMode, demoStatus } from "@/services/demo";
import type { SqlExecutor } from "@/infra/db";

let db: SqlExecutor;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeDb(db);
});

const request: AnalyseRequest = {
  jobPost: "x".repeat(100),
  save: false,
  coverLetter: false,
  lookupWebsite: true,
  maxAttempts: 3,
};
const visitor = { sVisitor: "11111111-1111-1111-1111-111111111111", sIpHash: "ip-hash" };

describe("demo mode", () => {
  it("is off unless DEMO_MODE says so, and leaves the request alone", async () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(demoMode()).toBe(false);
    expect(await prepareAnalysis(request, visitor)).toEqual({ request, demoClaim: null });
    expect((await demoStatus(visitor)).demo).toBe(false);
  });

  it("takes the visitor's one run and makes it a full, saved run without the website lookup", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const prepared = await prepareAnalysis(request, visitor);
    expect(prepared.demoClaim).toEqual(expect.any(Number));
    expect(prepared.request).toMatchObject({ save: true, coverLetter: true, lookupWebsite: false, maxAttempts: 2 });
  });

  it("refuses the second run with a message that says it is a demo", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    await prepareAnalysis(request, visitor);

    const refused = prepareAnalysis(request, visitor);
    await expect(refused).rejects.toBeInstanceOf(DemoBlockedError);
    await expect(prepareAnalysis(request, visitor)).rejects.toThrow(/demo environment.*Not allowed/i);

    const status = await demoStatus(visitor);
    expect(status).toMatchObject({ demo: true, runsLeft: 0 });
    expect(status.message).toMatch(/one AI analysis/);
  });

  it("reads the daily cap from the environment", () => {
    vi.stubEnv("DEMO_DAILY_RUN_CAP", "12");
    expect(demoLimits()).toEqual({ perVisitor: 1, perIpPerDay: 3, perDay: 12 });
    vi.stubEnv("DEMO_DAILY_RUN_CAP", "nonsense");
    expect(demoLimits().perDay).toBe(40);
  });
});

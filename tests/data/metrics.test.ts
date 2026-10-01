import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, daysAgo, freshDb, sampleJob } from "../helpers";
import { createJob, updateStatus } from "@/data/job-repository";
import { getDashboardMetrics } from "@/data/metrics";
import type { SqlExecutor } from "@/infra/db";

let db: SqlExecutor;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDb(db);
});

/** applied -> HR screen -> rejected, with real dates so the timing maths is exercised. */
async function rejectedAfterScreen() {
  const job = await createJob({ ...sampleJob, sCompany: "Datacom" }, { dtDateTime: daysAgo(30) });
  await updateStatus(job.uuid, "Applied", "", daysAgo(29));
  await updateStatus(job.uuid, "HR screen", "", daysAgo(22));
  await updateStatus(job.uuid, "Reject", "", daysAgo(20));
  return job;
}

const stage = (metrics: Awaited<ReturnType<typeof getDashboardMetrics>>, name: string) =>
  metrics.funnel.find((item) => item.stage === name)?.count ?? 0;

describe("dashboard metrics", () => {
  it("counts a rejected job at the depth it actually reached", async () => {
    await rejectedAfterScreen();
    const metrics = await getDashboardMetrics();

    expect(stage(metrics, "Applied")).toBe(1);
    expect(stage(metrics, "HR screen")).toBe(1);
    expect(stage(metrics, "Tech interview")).toBe(0);
    expect(metrics.totals.rejected).toBe(1);
    expect(metrics.rates.responseRate).toBe(100);
  });

  it("measures days from applying to the first real response", async () => {
    await rejectedAfterScreen();
    const metrics = await getDashboardMetrics();
    expect(metrics.rates.avgDaysToFirstResponse).toBe(7);
    expect(metrics.rates.medianDaysToFirstResponse).toBe(7);
  });

  it("ignores saved-but-never-sent jobs in the conversion rates", async () => {
    await createJob(sampleJob, { dtDateTime: daysAgo(5) });
    await rejectedAfterScreen();

    const metrics = await getDashboardMetrics();
    expect(metrics.totals.tracked).toBe(2);
    expect(metrics.totals.applied).toBe(1);
    expect(metrics.rates.responseRate).toBe(100);
  });

  it("reports conversion for every stage of the funnel", async () => {
    const job = await createJob(sampleJob, { dtDateTime: daysAgo(40) });
    await updateStatus(job.uuid, "Applied", "", daysAgo(39));
    await updateStatus(job.uuid, "HR screen", "", daysAgo(32));
    await updateStatus(job.uuid, "Tech interview", "", daysAgo(26));
    await updateStatus(job.uuid, "Behavior interview", "", daysAgo(20));
    await updateStatus(job.uuid, "Final", "", daysAgo(14));
    await updateStatus(job.uuid, "Offer", "", daysAgo(10));

    const metrics = await getDashboardMetrics();
    expect(stage(metrics, "Offer")).toBe(1);
    expect(metrics.rates.offerRate).toBe(100);
    expect(metrics.funnel.every((item) => item.conversionFromPrevious === 100)).toBe(true);
  });

  it("breaks results down by source, contract type and tech", async () => {
    const job = await createJob({ ...sampleJob, sSource: "LinkedIn", sContractType: "Contract" }, { dtDateTime: daysAgo(15) });
    await updateStatus(job.uuid, "Applied", "", daysAgo(14));
    await updateStatus(job.uuid, "HR screen", "", daysAgo(11));
    await updateStatus(job.uuid, "Tech interview", "", daysAgo(9));

    const metrics = await getDashboardMetrics();
    expect(metrics.bySource.find((item) => item.sSource === "LinkedIn")?.interviewRate).toBe(100);
    expect(metrics.byContractType.find((item) => item.sContractType === "Contract")?.applications).toBe(1);
    expect(metrics.topTech.find((item) => item.tech === "TypeScript")?.interviews).toBe(1);
  });

  it("leaves rows from a failed run out of every number", async () => {
    await rejectedAfterScreen();
    await createJob(sampleJob, { dtDateTime: daysAgo(3), bError: true });

    const metrics = await getDashboardMetrics();
    expect(metrics.totals.tracked).toBe(1);
  });

  it("honours the reporting window", async () => {
    const old = await createJob(sampleJob, { dtDateTime: daysAgo(200) });
    await updateStatus(old.uuid, "Applied", "", daysAgo(199));
    await rejectedAfterScreen();

    expect((await getDashboardMetrics()).totals.tracked).toBe(2);
    const recent = await getDashboardMetrics({ windowDays: 90 });
    expect(recent.totals.tracked).toBe(1);
    expect(recent.windowDays).toBe(90);
  });

  it("returns zeroes rather than NaN on an empty database", async () => {
    const metrics = await getDashboardMetrics();
    expect(metrics.totals.tracked).toBe(0);
    expect(metrics.rates.responseRate).toBe(0);
    expect(metrics.rates.avgDaysToFirstResponse).toBeNull();
    expect(metrics.funnel.every((item) => item.count === 0)).toBe(true);
  });
});

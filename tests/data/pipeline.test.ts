import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, daysAgo, freshDb, sampleJob } from "../helpers";
import { createJob, listJobs, updateStatus } from "@/data/job-repository";
import { getDashboardMetrics } from "@/data/metrics";
import { getPipeline } from "@/data/pipeline";
import { normaliseWindow, trackedWithin } from "@/data/window";
import type { SqlExecutor } from "@/infra/db";

let db: SqlExecutor;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDb(db);
});

const link = (pipeline: Awaited<ReturnType<typeof getPipeline>>, source: string, target: string) =>
  pipeline.links.find((item) => item.source === source && item.target === target)?.value ?? 0;

/** Everything that leaves "Tracked" is one job each, so this is how many jobs the graph holds. */
const jobsInGraph = (pipeline: Awaited<ReturnType<typeof getPipeline>>) =>
  pipeline.links.filter((item) => item.source === "Tracked").reduce((sum, item) => sum + item.value, 0);

describe("date range", () => {
  it("is one rule: all time, or whole days clamped to 1..3650", () => {
    expect(normaliseWindow(null)).toBeNull();
    expect(normaliseWindow(undefined)).toBeNull();
    expect(normaliseWindow(7.4)).toBe(7);
    expect(normaliseWindow(0)).toBe(1);
    expect(normaliseWindow(99_999)).toBe(3650);
    expect(trackedWithin(null)).toBeNull();
    expect(trackedWithin(14)).toBe("datetime(dtDateTime) >= datetime('now', '-14 days')");
  });

  it("makes the table, the tiles and the graph count the same applications in every range", async () => {
    for (const [index, age] of [2, 5, 10, 20, 45, 200].entries()) {
      await createJob({ ...sampleJob, sCompany: "Company " + index }, { dtDateTime: daysAgo(age) });
    }

    for (const windowDays of [7, 14, 30, 90, null]) {
      const listed = await listJobs({ windowDays });
      const metrics = await getDashboardMetrics({ windowDays });
      expect(listed.length).toBe(metrics.totals.tracked);
      expect(jobsInGraph(metrics.pipeline)).toBe(listed.length);
    }
    expect((await listJobs({ windowDays: 7 })).map((job) => job.sCompany).sort()).toEqual(["Company 0", "Company 1"]);
  });
});

describe("a status change moves the graph", () => {
  it("for any job the table shows, whatever the range", async () => {
    await createJob({ ...sampleJob, sCompany: "Old" }, { dtDateTime: daysAgo(60) });
    const recent = await createJob({ ...sampleJob, sCompany: "Recent" }, { dtDateTime: daysAgo(3) });

    for (const windowDays of [7, null]) {
      for (const job of await listJobs({ windowDays })) {
        const before = await getPipeline(windowDays);
        await updateStatus(job.uuid, "Applied", "");
        const after = await getPipeline(windowDays);
        expect(link(after, "Tracked", "Applied")).toBe(link(before, "Tracked", "Applied") + 1);
        await updateStatus(job.uuid, "Saved", "");
      }
    }
    expect(recent.uuid).toBeTruthy();
  });

  it("shows an offer that was then declined as a rejection after the offer", async () => {
    const job = await createJob(sampleJob, { dtDateTime: daysAgo(30) });
    await updateStatus(job.uuid, "Applied", "", daysAgo(29));
    await updateStatus(job.uuid, "Offer", "", daysAgo(10));

    const offered = await getPipeline(null);
    expect(link(offered, "Final", "Offer")).toBe(1);
    expect(link(offered, "Offer", "Rejected")).toBe(0);

    await updateStatus(job.uuid, "Reject", "declined");
    const declined = await getPipeline(null);
    expect(link(declined, "Final", "Offer")).toBe(1);
    expect(link(declined, "Offer", "Rejected")).toBe(1);
    expect(declined.nodes.find((node) => node.name === "Rejected")?.kind).toBe("rejected");
  });
});

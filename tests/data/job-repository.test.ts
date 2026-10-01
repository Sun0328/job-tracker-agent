import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, daysAgo, freshDb, sampleJob } from "../helpers";
import { createJob, deleteJob, getJob, listJobs, restoreJob, updateStatus } from "@/data/job-repository";
import type { SqlExecutor } from "@/infra/db";

let db: SqlExecutor;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDb(db);
});

describe("job store", () => {
  it("starts a new job at Saved with nothing applied", async () => {
    const job = await createJob(sampleJob);
    expect(job.sStatus).toBe("Saved");
    expect(job.sDeepestStatus).toBe("Saved");
    expect(job.dtApplied).toBeNull();
    expect(job.dtFirstResponse).toBeNull();
  });

  it("stamps the applied and first-reply dates as it moves", async () => {
    const job = await createJob(sampleJob, { dtDateTime: daysAgo(20) });
    const applied = await updateStatus(job.uuid, "Applied", "sent", { when: daysAgo(18) });
    expect(applied.dtApplied).toBe(daysAgo(18));
    expect(applied.dtFirstResponse).toBeNull();

    const screened = await updateStatus(job.uuid, "HR screen", "", { when: daysAgo(14) });
    expect(screened.dtApplied).toBe(daysAgo(18));
    expect(screened.dtFirstResponse).toBe(daysAgo(14));
    expect(screened.sDeepestStatus).toBe("HR screen");
  });

  it("keeps the furthest stage when a job is rejected", async () => {
    const job = await createJob(sampleJob, { dtDateTime: daysAgo(20) });
    await updateStatus(job.uuid, "Applied", "", { when: daysAgo(18) });
    await updateStatus(job.uuid, "Tech interview", "", { when: daysAgo(12) });
    const rejected = await updateStatus(job.uuid, "Reject", "no thanks");

    expect(rejected.sStatus).toBe("Reject");
    expect(rejected.sDeepestStatus).toBe("Tech interview");
  });

  it("drops the deepest stage back when you correct a mistake", async () => {
    const job = await createJob(sampleJob, { dtDateTime: daysAgo(20) });
    await updateStatus(job.uuid, "Applied", "", { when: daysAgo(18) });
    await updateStatus(job.uuid, "Tech interview", "picked by mistake", { when: daysAgo(12) });

    const corrected = await updateStatus(job.uuid, "Applied", "back to applied");
    expect(corrected.sStatus).toBe("Applied");
    expect(corrected.sDeepestStatus).toBe("Applied");
    expect(corrected.dtFirstResponse).toBeNull();
  });

  it("clears the applied date when you go all the way back to Saved", async () => {
    const job = await createJob(sampleJob, { dtDateTime: daysAgo(20) });
    await updateStatus(job.uuid, "Applied", "", { when: daysAgo(18) });
    const back = await updateStatus(job.uuid, "Saved", "not sent after all");

    expect(back.sDeepestStatus).toBe("Saved");
    expect(back.dtApplied).toBeNull();
  });

  it("can be told to keep the furthest stage instead of correcting", async () => {
    const job = await createJob(sampleJob, { dtDateTime: daysAgo(20) });
    await updateStatus(job.uuid, "Tech interview", "", { when: daysAgo(12) });
    const kept = await updateStatus(job.uuid, "Applied", "", { correct: false });
    expect(kept.sDeepestStatus).toBe("Tech interview");
  });

  it("round-trips the JSON columns", async () => {
    const created = await createJob(sampleJob);
    const loaded = await getJob(created.uuid);
    expect(loaded?.sTechStack).toEqual(["TypeScript", "Playwright"]);
    expect(loaded?.sCompanyMeta?.industry).toBe("Agritech");
    expect(loaded?.bAgency).toBe(false);
  });

  it("stores an agency advert with no company metadata", async () => {
    const created = await createJob({ ...sampleJob, bAgency: true, sCompanyMeta: null });
    const loaded = await getJob(created.uuid);
    expect(loaded?.bAgency).toBe(true);
    expect(loaded?.sCompanyMeta).toBeNull();
  });

  it("filters by status, source and active only", async () => {
    const first = await createJob(sampleJob);
    const second = await createJob({ ...sampleJob, sCompany: "Xero", sSource: "LinkedIn" });
    await updateStatus(second.uuid, "Reject", "");

    expect((await listJobs({ sStatus: "Saved" })).map((job) => job.uuid)).toEqual([first.uuid]);
    expect((await listJobs({ activeOnly: true })).map((job) => job.uuid)).toEqual([first.uuid]);
    expect(await listJobs({ sSource: "LinkedIn" })).toHaveLength(1);
    expect(await listJobs({ search: "Xero" })).toHaveLength(1);
  });

  it("soft deletes by default and can restore", async () => {
    const job = await createJob(sampleJob);
    expect(await deleteJob(job.uuid)).toBe(true);
    expect(await listJobs()).toHaveLength(0);
    expect((await getJob(job.uuid))?.bDelete).toBe(true);

    expect(await restoreJob(job.uuid)).toBe(true);
    expect(await listJobs()).toHaveLength(1);
  });

  it("hard deletes the row", async () => {
    const job = await createJob(sampleJob);
    expect(await deleteJob(job.uuid, true)).toBe(true);
    expect(await getJob(job.uuid)).toBeNull();
  });

  it("refuses to update a job that does not exist", async () => {
    await expect(updateStatus("nope", "Applied", "")).rejects.toThrow("Job not found");
  });
});

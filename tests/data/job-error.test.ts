import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, freshDb } from "../helpers";
import { createJob, getJob, listJobs } from "@/data/job-repository";
import type { ExtractedJob } from "@/domain";
import type { SqlExecutor } from "@/infra/db";

const job: ExtractedJob = {
  sCompany: "Halter",
  bAgency: false,
  sCompanyMeta: null,
  sJobTitle: "QA Automation Engineer",
  sJobRequirement: "- 5 years",
  sContractType: "Permanent",
  sLocation: "Auckland",
  sJobSummary: "Own the test strategy.",
  sSource: "SEEK",
  sSourceUrl: null,
  sTechStack: ["Playwright"],
};

let db: SqlExecutor;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDb(db);
});

describe("bError on a tracked application", () => {
  it("defaults to 0 for a clean run", async () => {
    const created = await createJob(job, { sRunID: "run-1" });
    expect(created.bError).toBe(false);
    expect((await getJob(created.uuid))?.bError).toBe(false);
  });

  it("stores a flagged row when the run went wrong", async () => {
    const created = await createJob(
      { ...job, sCompany: "(unknown)", sJobTitle: "(extraction failed)" },
      { sRunID: "run-2", bError: true, sNote: "missing required fields: sCompany" },
    );
    const loaded = await getJob(created.uuid);
    expect(loaded?.bError).toBe(true);
    expect(loaded?.sNote).toContain("missing required fields");
  });

  it("keeps flagged rows out of the normal list", async () => {
    const clean = await createJob(job, { sRunID: "run-3" });
    const broken = await createJob(job, { sRunID: "run-4", bError: true });

    const normal = await listJobs();
    expect(normal.map((item) => item.uuid)).toEqual([clean.uuid]);

    const all = await listJobs({ includeErrors: true });
    expect(all.map((item) => item.uuid).sort()).toEqual([clean.uuid, broken.uuid].sort());
  });

  it("links the row back to the run that produced it", async () => {
    const created = await createJob(job, { sRunID: "run-5", bError: true });
    expect((await getJob(created.uuid))?.sRunID).toBe("run-5");
  });
});

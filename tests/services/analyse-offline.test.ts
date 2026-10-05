import { cpSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, freshDb } from "../helpers";
import { DEMO_EXAMPLE_ADVERT } from "@/components/demo-example";
import { analyseJob, prepareAnalysis, serialiseAnalysis, type AnalyseRequest } from "@/services/analyse-job";
import { DemoBlockedError, demoStatus } from "@/services/demo";
import { createLocalFileStorage } from "@/infra/storage/local-files";
import { getFileStorage, setFileStorage } from "@/infra/storage";
import type { SqlExecutor } from "@/infra/db";

/**
 * The whole agent, end to end, with no model key: identify, extract (the offline
 * parser), save, choose a CV, write and render the letter, store the PDF. This is
 * the run a demo visitor gets, minus the network, so a broken step fails here
 * before it fails on the live site.
 */

let db: SqlExecutor;
let root: string;

const request: AnalyseRequest = {
  jobPost: DEMO_EXAMPLE_ADVERT,
  save: false,
  coverLetter: false,
  lookupWebsite: true,
  maxAttempts: 3,
};
const visitor = { sVisitor: "22222222-2222-2222-2222-222222222222", sIpHash: "ip-hash-offline" };

beforeEach(async () => {
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("DEMO_MODE", "1");
  db = await freshDb();
  root = await mkdtemp(path.join(tmpdir(), "jobpilot-offline-"));
  // What the demo bucket gives the Worker: the fictional profile, two CVs and their text.
  for (const folder of ["profile", "resume", "resume-text"]) {
    cpSync(path.join(process.cwd(), "demo", "bucket", folder), path.join(root, folder), { recursive: true });
  }
  setFileStorage(createLocalFileStorage(root));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  setFileStorage(null);
  await closeDb(db);
  await rm(root, { recursive: true, force: true });
});

describe("a demo visitor's run, offline", () => {
  it("saves the application and a one-page letter PDF for the fictional candidate", async () => {
    const prepared = await prepareAnalysis(request, visitor);
    const result = await analyseJob(prepared);

    expect(result.error).toBeNull();
    expect(result.outcome).toBe("succeeded");

    // The application is in the database, with the letter's key on it.
    expect(result.saved?.sCompany).toBe(result.job?.sCompany);
    const row = await db.first<{ sCoverLetterPath: string | null; sStatus: string } & Record<string, unknown>>(
      "SELECT sCoverLetterPath, sStatus FROM Job WHERE uuid = ?",
      [result.saved!.uuid],
    );
    expect(row?.sStatus).toBe("Saved");
    expect(row?.sCoverLetterPath).toBe(result.letter?.sCoverLetterPath);

    // The PDF is in storage and is a real, single-page PDF.
    const pdf = await getFileStorage().get(row!.sCoverLetterPath!);
    expect(pdf?.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(pdf!.body.slice(0, 5))).toBe("%PDF-");
    expect(result.letter?.pages).toBe(1);

    // It is written for the fictional candidate, from one of the demo CVs.
    expect(result.letter?.text).toContain("Alex Rivera");
    expect(result.letter?.resume?.sFileName).toMatch(/^Alex_Rivera_CV_.+\.pdf$/);

    // The run is archived with its steps, which is what the trace panel replays.
    const payload = serialiseAnalysis(result);
    const steps = payload.run.aSteps.map((step) => step.sName);
    expect(steps).toEqual(expect.arrayContaining(["identify", "persist", "save-pdf"]));
    const archived = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM AgentRunStep WHERE sRunUUID = ?", [payload.runId]);
    expect(Number(archived?.count)).toBe(steps.length);
  });

  it("uses up the visitor's one run: the next is refused before anything starts", async () => {
    await analyseJob(await prepareAnalysis(request, visitor));

    expect(await demoStatus(visitor)).toMatchObject({ runsLeft: 0 });
    await expect(prepareAnalysis(request, visitor)).rejects.toEqual(new DemoBlockedError("visitor"));
  });

  it("gives the run back when the run breaks", async () => {
    const prepared = await prepareAnalysis(request, visitor);
    expect(await demoStatus(visitor)).toMatchObject({ runsLeft: 0 });
    // Saving the application is the step that breaks: the table is gone.
    await db.run("ALTER TABLE Job RENAME TO JobUnavailable");

    const outcome = await analyseJob(prepared).then((result) => result.outcome, () => "threw");

    expect(["failed", "threw"]).toContain(outcome);
    expect(await demoStatus(visitor)).toMatchObject({ runsLeft: 1 });
  });
});

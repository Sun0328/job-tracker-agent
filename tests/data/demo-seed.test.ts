import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, freshDb } from "../helpers";
import { splitStatements, type SqlExecutor } from "@/infra/db";
import { CONTRACT_TYPES, JOB_SOURCES, JOB_STATUSES, STATUS_RANK, type JobStatus } from "@/domain";

/**
 * The public demo ships demo/seed.sql and demo/bucket/ as they are. These tests
 * are its contract: the seed loads into the current schema, every row is one
 * the app accepts, every file it points at is in the bucket, and nothing in it
 * belongs to a real person.
 */

const ROOT = process.cwd();
const DEMO = path.join(ROOT, "demo");
const BUCKET = path.join(DEMO, "bucket");

let db: SqlExecutor;

interface JobRow {
  uuid: string;
  sStatus: string;
  sDeepestStatus: string;
  sContractType: string;
  sSource: string;
  sCoverLetterPath: string | null;
  sRunID: string | null;
  bError: number;
  bDelete: number;
  dtDateTime: string;
}

beforeAll(async () => {
  db = await freshDb();
  const seed = await readFile(path.join(DEMO, "seed.sql"), "utf8");
  for (const statement of splitStatements(seed)) await db.run(statement);
});

afterAll(async () => {
  await closeDb(db);
});

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : Promise.resolve([full]);
  }));
  return nested.flat();
}

const bucketKey = (file: string) => path.relative(BUCKET, file).split(path.sep).join("/");

describe("demo seed", () => {
  it("loads into a freshly migrated database: 10 applications, each with its archived run", async () => {
    const jobs = await db.all<JobRow & Record<string, unknown>>("SELECT * FROM Job");
    expect(jobs).toHaveLength(10);
    expect(jobs.every((job) => Number(job.bDelete) === 0 && Number(job.bError) === 0)).toBe(true);

    const runs = await db.all<{ uuid: string } & Record<string, unknown>>("SELECT uuid FROM AgentRun");
    const runIds = new Set(runs.map((run) => run.uuid));
    expect(runs).toHaveLength(10);
    expect(jobs.filter((job) => !job.sRunID || !runIds.has(job.sRunID)).map((job) => job.uuid)).toEqual([]);

    const orphanSteps = await db.first<{ count: number }>(
      "SELECT COUNT(*) AS count FROM AgentRunStep WHERE sRunUUID NOT IN (SELECT uuid FROM AgentRun)",
    );
    expect(Number(orphanSteps?.count)).toBe(0);
  });

  it("holds only values the app accepts, and a furthest stage never behind the current one", async () => {
    const jobs = await db.all<JobRow & Record<string, unknown>>("SELECT * FROM Job");
    for (const job of jobs) {
      expect(JOB_STATUSES).toContain(job.sStatus);
      expect(JOB_STATUSES).toContain(job.sDeepestStatus);
      expect(CONTRACT_TYPES).toContain(job.sContractType);
      expect(JOB_SOURCES).toContain(job.sSource);
      expect(STATUS_RANK[job.sDeepestStatus as JobStatus]).toBeGreaterThanOrEqual(STATUS_RANK[job.sStatus as JobStatus]);
    }
  });

  it("dates every application relative to today, so the demo never looks stale", async () => {
    const jobs = await db.all<JobRow & Record<string, unknown>>("SELECT dtDateTime FROM Job");
    const ages = jobs.map((job) => (Date.now() - Date.parse(job.dtDateTime)) / 86_400_000);
    expect(Math.min(...ages)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...ages)).toBeLessThan(7);
    expect(Math.max(...ages)).toBeLessThan(120);
  });

  it("points only at files that are in demo/bucket, at their recorded size", async () => {
    const letters = await db.all<{ sCoverLetterPath: string | null } & Record<string, unknown>>("SELECT sCoverLetterPath FROM Job");
    for (const { sCoverLetterPath } of letters) {
      expect(sCoverLetterPath).toBeTruthy();
      expect(existsSync(path.join(BUCKET, sCoverLetterPath!)), sCoverLetterPath!).toBe(true);
    }

    const files = await db.all<{ sStoragePath: string; iSizeBytes: number } & Record<string, unknown>>(
      "SELECT sStoragePath, iSizeBytes FROM JobFile WHERE bDelete = 0",
    );
    for (const file of files) {
      const onDisk = await stat(path.join(BUCKET, file.sStoragePath));
      expect(onDisk.size, file.sStoragePath).toBe(Number(file.iSizeBytes));
    }
  });

  it("ships every CV with its pre-extracted text, made from that exact file", async () => {
    const resumes = (await filesUnder(path.join(BUCKET, "resume"))).filter((file) => file.endsWith(".pdf"));
    expect(resumes.length).toBeGreaterThan(0);
    for (const resume of resumes) {
      const key = bucketKey(resume);
      const cache = JSON.parse(await readFile(path.join(BUCKET, "resume-text", key + ".json"), "utf8")) as { size: number; text: string };
      expect(cache.size, key).toBe((await stat(resume)).size);
      expect(cache.text.trim().length, key).toBeGreaterThan(200);
    }
  });
});

describe("demo privacy", () => {
  async function demoText(): Promise<Array<{ file: string; text: string }>> {
    const files = [
      ...(await filesUnder(DEMO)).filter((file) => /\.(sql|json|md|txt)$/.test(file)),
      path.join(ROOT, "src", "components", "demo-example.ts"),
    ];
    return Promise.all(files.map(async (file) => ({ file: path.relative(ROOT, file), text: await readFile(file, "utf8") })));
  }

  it("uses only the fictional email domain", async () => {
    const found: string[] = [];
    for (const { file, text } of await demoText()) {
      for (const email of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) ?? []) {
        if (!email.endsWith("@inspectcopilot.com")) found.push(file + ": " + email);
      }
    }
    expect(found).toEqual([]);
  });

  it("uses only the fictional 555 phone range", async () => {
    const found: string[] = [];
    for (const { file, text } of await demoText()) {
      for (const phone of text.match(/\b0[2-9]\d?[ -]?\d{3}[ -]?\d{3,4}\b/g) ?? []) {
        if (!/^0\d{1,2}[ -]?555[ -]?01\d\d$/.test(phone)) found.push(file + ": " + phone);
      }
    }
    expect(found).toEqual([]);
  });

  // The real profile is gitignored, so this runs on the owner's machine only. It
  // is the check that matters most before `npm run demo:data` output is committed.
  const realProfile = path.join(ROOT, "data", "candidate.json");
  it.skipIf(!existsSync(realProfile))("contains nothing from the real candidate profile", async () => {
    const real = JSON.parse(await readFile(realProfile, "utf8")) as Record<string, unknown>;
    const needles = ["fullName", "email", "phone"]
      .map((field) => ({ field, value: real[field] }))
      .filter((item): item is { field: string; value: string } => typeof item.value === "string" && item.value.trim().length >= 6)
      .map((item) => ({ field: item.field, value: item.value.trim().toLowerCase() }));
    expect(needles.length).toBeGreaterThan(0);
    const found: string[] = [];
    for (const { file, text } of await demoText()) {
      const lower = text.toLowerCase();
      // Name the file and the field, never the value: this output is a CI log.
      for (const needle of needles) {
        if (lower.includes(needle.value)) found.push(file + " contains the real " + needle.field);
      }
    }
    expect(found).toEqual([]);
  });
});

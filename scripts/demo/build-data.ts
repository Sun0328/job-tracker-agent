import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flag } from "@/cli/args";
import { loadEnv } from "@/infra/env";
import type { JobStatus } from "@/domain";
import { renderResumePdf, type DemoResume } from "./resume-pdf";

/**
 * Builds the demo's data from the fictional inputs in demo/:
 *
 *   1. a throwaway local database and bucket in data/demo/work (never your real ones),
 *   2. the fictional candidate profile and two CV variants, rendered to PDF,
 *   3. one real agent run per advert in demo/adverts (DeepSeek, a few cents),
 *   4. each application walked through demo/adverts/plan.json,
 *   5. demo/seed.sql and demo/bucket/, which the reset loads into the demo D1 and R2.
 *
 *   npm run demo:data                 everything (about 15 minutes of agent runs)
 *   npm run demo:data -- --export     re-export the work database without new runs
 */

const ROOT = process.cwd();
const DEMO = path.join(ROOT, "demo");
const WORK = path.join(ROOT, "data", "demo", "work");
const WORK_DB = path.join(WORK, "jobpilot-demo.db");
const WORK_BUCKET = path.join(WORK, "bucket");

const STATUS_NOTE: Record<JobStatus, string> = {
  Saved: "",
  Applied: "Applied online",
  "HR screen": "Recruiter call",
  "Tech interview": "Technical interview",
  "Behavior interview": "Values interview",
  Final: "Final round",
  Offer: "Offer received",
  Reject: "Not progressing",
};

interface Plan {
  applications: Array<{ file: string; tracked: number; steps: Array<[JobStatus, number]> }>;
}

function isoDaysAgo(days: number, hour: number, now = new Date()): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

/** Local only: nothing in this process may reach the real database or bucket. */
function isolate() {
  loadEnv();
  for (const key of Object.keys(process.env)) {
    if (/^(CLOUDFLARE_|R2_|DEMO_)/.test(key)) delete process.env[key];
  }
  process.env.JOB_DB = "local";
  process.env.LOCAL_DB_PATH = WORK_DB;
  process.env.FILE_STORAGE = "local";
  process.env.LOCAL_FILES_PATH = WORK_BUCKET;
}

async function generate() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK_BUCKET, { recursive: true });

  const { getDb, splitStatements } = await import("@/infra/db");
  const { saveFile } = await import("@/data/file-repository");
  const { writeResumeTextCache } = await import("@/data/resume-repository");
  const { extractPdfText } = await import("@/infra/pdf/extract-text");
  const { createRunTrace } = await import("@/agent/core/create-trace");
  const { runMainAgent } = await import("@/agent/main-agent");
  const { updateStatus } = await import("@/data/job-repository");
  const { deepSeekConfigured } = await import("@/infra/llm/deepseek");
  if (!deepSeekConfigured()) throw new Error("DEEPSEEK_API_KEY is empty: the demo runs are real agent runs.");

  const db = await getDb();
  for (const file of readdirSync(path.join(ROOT, "db", "migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of splitStatements(readFileSync(path.join(ROOT, "db", "migrations", file), "utf8"))) await db.run(statement);
  }

  // The fictional candidate, where the Worker reads it: profile/ in the bucket.
  cpSync(path.join(DEMO, "profile"), path.join(WORK_BUCKET, "profile"), { recursive: true });

  // Two CV variants, plus the text pulled out of each, so the Worker never parses a PDF.
  const resume = JSON.parse(readFileSync(path.join(DEMO, "resume.json"), "utf8")) as DemoResume;
  for (const [index, variant] of resume.variants.entries()) {
    const bytes = await renderResumePdf(resume, index);
    const key = "resume/" + variant.fileName;
    await saveFile({ body: bytes, sFileName: variant.fileName, sContentType: "application/pdf", sKind: "cv", sStoragePath: key, sNote: variant.note });
    const extracted = await extractPdfText(bytes, variant.fileName);
    await writeResumeTextCache(key, { size: bytes.byteLength, text: extracted.text, pages: extracted.pages });
    console.log("cv: " + key + " (" + extracted.pages + " page, " + extracted.chars + " chars)");
  }

  const plan = JSON.parse(readFileSync(path.join(DEMO, "adverts", "plan.json"), "utf8")) as Plan;
  const now = new Date();

  for (const application of plan.applications) {
    const advert = readFileSync(path.join(DEMO, "adverts", application.file), "utf8");
    let saved: { uuid: string } | null = null;

    for (let attempt = 1; attempt <= 2 && !saved; attempt += 1) {
      const started = Date.now();
      const trace = createRunTrace(advert);
      const result = await runMainAgent({ jobPost: advert, trace, save: true, coverLetter: true, lookupWebsite: false, maxAttempts: 2 });
      const seconds = Math.round((Date.now() - started) / 1000);
      if (result.outcome === "succeeded" && result.saved && result.letter?.sCoverLetterPath) {
        saved = result.saved;
        console.log("run: " + application.file + " -> " + result.saved.sCompany + ", " + result.saved.sJobTitle + " (" + seconds + "s)");
      } else {
        console.log("run: " + application.file + " attempt " + attempt + " did not finish: " + (result.error ?? result.warnings.join("; ")));
      }
    }
    if (!saved) throw new Error("Could not build a complete application from " + application.file);

    // Walk it through its plan, then move every timestamp of its run back to when it was tracked.
    const tracked = isoDaysAgo(application.tracked, 9, now);
    for (const [status, daysAgo] of application.steps) {
      await updateStatus(saved.uuid, status, STATUS_NOTE[status], { when: isoDaysAgo(daysAgo, 11, now) });
    }
    const run = await db.first<{ uuid: string; dtDateTime: string }>("SELECT uuid, dtDateTime FROM AgentRun WHERE sJobUUID = ?", [saved.uuid]);
    const shift = run ? Date.parse(tracked) - Date.parse(run.dtDateTime) : 0;
    const moved = (iso: string | null) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : null);

    await db.run("UPDATE Job SET dtDateTime = ? WHERE uuid = ?", [tracked, saved.uuid]);
    if (!application.steps.length) {
      await db.run("UPDATE Job SET dtUpdateDateTime = ? WHERE uuid = ?", [new Date(Date.parse(tracked) + 10 * 60_000).toISOString(), saved.uuid]);
    }
    if (run) {
      const full = await db.first<{ dtFinishDateTime: string | null }>("SELECT dtFinishDateTime FROM AgentRun WHERE uuid = ?", [run.uuid]);
      await db.run("UPDATE AgentRun SET dtDateTime = ?, dtFinishDateTime = ? WHERE uuid = ?", [moved(run.dtDateTime), moved(full?.dtFinishDateTime ?? null), run.uuid]);
      for (const step of await db.all<{ iID: number; dtDateTime: string }>("SELECT iID, dtDateTime FROM AgentRunStep WHERE sRunUUID = ?", [run.uuid])) {
        await db.run("UPDATE AgentRunStep SET dtDateTime = ? WHERE iID = ?", [moved(step.dtDateTime), step.iID]);
      }
    }
    for (const file of await db.all<{ uuid: string; dtDateTime: string }>("SELECT uuid, dtDateTime FROM JobFile WHERE sJobUUID = ?", [saved.uuid])) {
      await db.run("UPDATE JobFile SET dtDateTime = ? WHERE uuid = ?", [moved(file.dtDateTime), file.uuid]);
    }
  }

  // The CV rows date from before the first application.
  const first = isoDaysAgo(Math.max(...plan.applications.map((item) => item.tracked)) + 3, 8, now);
  await db.run("UPDATE JobFile SET dtDateTime = ? WHERE sKind = 'cv'", [first]);
  // Left open: the export reads the same connection, and closes it.
}

/** A literal for one value. Dates become offsets from 'now', so the demo never ages. */
function sqlLiteral(column: string, value: unknown, exportedAt: number): string {
  if (value == null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const text = String(value);
  if (column.startsWith("dt") && /^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(Date.parse(text))) {
    const seconds = Math.max(0, Math.round((exportedAt - Date.parse(text)) / 1000));
    return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-" + seconds + " seconds')";
  }
  return "'" + text.replace(/'/g, "''") + "'";
}

async function exportSeed() {
  const { getDb } = await import("@/infra/db");
  const db = await getDb();
  const exportedAt = Date.now();

  const lines = [
    "-- JobPilot demo data. Fictional candidate (Alex Rivera), fictional companies.",
    "-- Generated by `npm run demo:data`; loaded into the demo D1 by `npm run demo:reset`.",
    "-- Dates are written relative to the moment this file runs, so the demo never ages.",
    "-- DemoRun (who used their one live run) is deliberately left alone.",
    "",
    "DELETE FROM AgentRunStep;",
    "DELETE FROM AgentRun;",
    "DELETE FROM JobFile;",
    "DELETE FROM Job;",
    "",
  ];

  const tables: Array<{ table: string; order: string; skip?: string[] }> = [
    { table: "Job", order: "datetime(dtDateTime), uuid" },
    { table: "JobFile", order: "datetime(dtDateTime), uuid" },
    { table: "AgentRun", order: "datetime(dtDateTime), uuid" },
    { table: "AgentRunStep", order: "sRunUUID, iSeq", skip: ["iID"] },
  ];

  let rows = 0;
  for (const { table, order, skip = [] } of tables) {
    for (const row of await db.all("SELECT * FROM " + table + " ORDER BY " + order)) {
      const columns = Object.keys(row).filter((column) => !skip.includes(column));
      lines.push(
        "INSERT INTO " + table + " (" + columns.join(", ") + ") VALUES ("
          + columns.map((column) => sqlLiteral(column, row[column], exportedAt)).join(", ") + ");",
      );
      rows += 1;
    }
    lines.push("");
  }
  await db.close();

  writeFileSync(path.join(DEMO, "seed.sql"), lines.join("\n"), "utf8");
  rmSync(path.join(DEMO, "bucket"), { recursive: true, force: true });
  cpSync(WORK_BUCKET, path.join(DEMO, "bucket"), { recursive: true });
  console.log("seed: " + rows + " rows to demo/seed.sql, bucket copied to demo/bucket/");
}

async function main() {
  isolate();
  if (flag("export")) {
    if (!existsSync(WORK_DB)) throw new Error("No work database yet. Run `npm run demo:data` without --export first.");
  } else {
    await generate();
  }
  await exportSeed();
}

main().catch((error) => {
  console.error("\ndemo data failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});

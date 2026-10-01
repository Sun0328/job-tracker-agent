import { randomUUID } from "node:crypto";
import { getDb } from "@/infra/db";
import type { Row } from "@/infra/db";
import {
  CLOSED_STATUSES,
  STATUS_RANK,
  type CompanyMeta,
  type ContractType,
  type ExtractedJob,
  type Job,
  type JobSource,
  type JobStatus,
} from "@/domain";

const JOB_COLUMNS = [
  "uuid", "sCompany", "bAgency", "sCompanyMeta", "sJobTitle", "sJobRequirement", "sContractType",
  "sLocation", "sCoverLetterPath", "sStatus", "bDelete", "dtDateTime", "dtUpdateDateTime",
  "sJobSummary", "sSource", "sSourceUrl", "sTechStack", "sNote", "sRunID", "bError",
  "sDeepestStatus", "dtApplied", "dtFirstResponse",
];
const SELECT_COLUMNS = JOB_COLUMNS.join(", ");

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result === "" ? null : result;
}

function bool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseMeta(value: unknown): CompanyMeta | null {
  if (value && typeof value === "object") return value as CompanyMeta;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as CompanyMeta;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function rowToJob(row: Row): Job {
  return {
    uuid: text(row.uuid),
    sCompany: text(row.sCompany),
    bAgency: bool(row.bAgency),
    sCompanyMeta: parseMeta(row.sCompanyMeta),
    sJobTitle: text(row.sJobTitle),
    sJobRequirement: text(row.sJobRequirement),
    // Older rows can hold NULL; extraction always supplies a value now.
    sContractType: (nullableText(row.sContractType) ?? "Permanent") as ContractType,
    sLocation: nullableText(row.sLocation),
    sCoverLetterPath: nullableText(row.sCoverLetterPath),
    sStatus: text(row.sStatus) as JobStatus,
    bDelete: bool(row.bDelete),
    dtDateTime: text(row.dtDateTime),
    dtUpdateDateTime: text(row.dtUpdateDateTime),
    sJobSummary: text(row.sJobSummary),
    sSource: text(row.sSource) as JobSource,
    sSourceUrl: nullableText(row.sSourceUrl),
    sTechStack: parseList(row.sTechStack),
    sNote: text(row.sNote),
    sRunID: nullableText(row.sRunID),
    bError: bool(row.bError),
    sDeepestStatus: (nullableText(row.sDeepestStatus) ?? "Saved") as JobStatus,
    dtApplied: nullableText(row.dtApplied),
    dtFirstResponse: nullableText(row.dtFirstResponse),
  };
}

export interface JobFilter {
  sStatus?: JobStatus | JobStatus[];
  sSource?: string;
  sCompany?: string;
  sContractType?: ContractType;
  search?: string;
  /** Still in play: not Reject, not Offer. */
  activeOnly?: boolean;
  /** Include soft-deleted rows. Off by default. */
  includeDeleted?: boolean;
  /** Include rows from runs that went wrong. Off by default. */
  includeErrors?: boolean;
  limit?: number;
  offset?: number;
}

export async function listJobs(filter: JobFilter = {}): Promise<Job[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (!filter.includeDeleted) where.push("bDelete = 0");
  if (!filter.includeErrors) where.push("bError = 0");
  if (filter.sStatus) {
    const statuses = Array.isArray(filter.sStatus) ? filter.sStatus : [filter.sStatus];
    where.push("sStatus IN (" + statuses.map(() => "?").join(", ") + ")");
    params.push(...statuses);
  }
  if (filter.activeOnly) {
    where.push("sStatus NOT IN (" + CLOSED_STATUSES.map(() => "?").join(", ") + ")");
    params.push(...CLOSED_STATUSES);
  }
  if (filter.sSource) {
    where.push("sSource = ?");
    params.push(filter.sSource);
  }
  if (filter.sCompany) {
    where.push("sCompany = ?");
    params.push(filter.sCompany);
  }
  if (filter.sContractType) {
    where.push("sContractType = ?");
    params.push(filter.sContractType);
  }
  if (filter.search) {
    where.push("(sCompany LIKE ? OR sJobTitle LIKE ? OR sJobSummary LIKE ?)");
    const like = "%" + filter.search + "%";
    params.push(like, like, like);
  }

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const sql = [
    "SELECT " + SELECT_COLUMNS + " FROM Job",
    where.length ? "WHERE " + where.join(" AND ") : "",
    "ORDER BY datetime(dtDateTime) DESC, uuid DESC",
    "LIMIT ? OFFSET ?",
  ].filter(Boolean).join("\n");

  const rows = await db.all(sql, [...params, limit, offset]);
  return rows.map(rowToJob);
}

export async function getJob(uuid: string): Promise<Job | null> {
  const db = await getDb();
  const row = await db.first("SELECT " + SELECT_COLUMNS + " FROM Job WHERE uuid = ?", [uuid]);
  return row ? rowToJob(row) : null;
}

export interface CreateJobOptions {
  sRunID?: string | null;
  sCoverLetterPath?: string | null;
  /** Seeds and imports backfill these; the normal path leaves them alone. */
  dtDateTime?: string;
  sStatus?: JobStatus;
  sNote?: string;
  /** Set when the run that produced this record failed or was incomplete. */
  bError?: boolean;
}

export async function createJob(input: ExtractedJob, options: CreateJobOptions = {}): Promise<Job> {
  const db = await getDb();
  const now = options.dtDateTime ?? new Date().toISOString();
  const sStatus: JobStatus = options.sStatus ?? "Saved";
  const rank = STATUS_RANK[sStatus];

  const job: Job = {
    ...input,
    uuid: randomUUID(),
    sCoverLetterPath: options.sCoverLetterPath ?? null,
    sStatus,
    bDelete: false,
    dtDateTime: now,
    dtUpdateDateTime: now,
    sNote: options.sNote ?? "",
    sRunID: options.sRunID ?? null,
    bError: options.bError ?? false,
    sDeepestStatus: sStatus,
    dtApplied: rank >= 1 ? now : null,
    dtFirstResponse: rank >= 2 ? now : null,
  };

  await db.run(
    "INSERT INTO Job (" + SELECT_COLUMNS + ") VALUES (" + JOB_COLUMNS.map(() => "?").join(", ") + ")",
    [
      job.uuid, job.sCompany, job.bAgency ? 1 : 0,
      job.sCompanyMeta ? JSON.stringify(job.sCompanyMeta) : null,
      job.sJobTitle, job.sJobRequirement, job.sContractType, job.sLocation, job.sCoverLetterPath,
      job.sStatus, 0, job.dtDateTime, job.dtUpdateDateTime, job.sJobSummary, job.sSource,
      job.sSourceUrl, JSON.stringify(job.sTechStack), job.sNote, job.sRunID, job.bError ? 1 : 0,
      job.sDeepestStatus, job.dtApplied, job.dtFirstResponse,
    ],
  );
  return job;
}

export interface UpdateStatusOptions {
  /** ISO timestamp for the change. Defaults to now. */
  when?: string;
  /**
   * Moving to an earlier stage is treated as fixing a mistake: the deepest stage
   * drops back with it. Set false to keep the furthest point already reached.
   */
  correct?: boolean;
}

/**
 * One UPDATE. sStatus is where the application is now; sDeepestStatus, dtApplied
 * and dtFirstResponse carry the facts the funnel and the pipeline need, so there
 * is no separate history to keep in step.
 */
export async function updateStatus(
  uuid: string,
  sStatus: JobStatus,
  sNote = "",
  options: string | UpdateStatusOptions = {},
): Promise<Job> {
  const settings: UpdateStatusOptions = typeof options === "string" ? { when: options } : options;
  const existing = await getJob(uuid);
  if (!existing) throw new Error("Job not found: " + uuid);

  const now = settings.when ?? new Date().toISOString();
  const rank = STATUS_RANK[sStatus];
  const isOutcome = CLOSED_STATUSES.includes(sStatus);
  const deepestRank = STATUS_RANK[existing.sDeepestStatus] ?? 0;

  // An outcome keeps the stage it was reached from. An active stage sets the
  // record to itself, so a step back undoes a mistake.
  let sDeepestStatus = existing.sDeepestStatus;
  if (!isOutcome) sDeepestStatus = settings.correct === false && deepestRank > rank ? existing.sDeepestStatus : sStatus;
  else if (rank > deepestRank) sDeepestStatus = sStatus;

  const finalRank = STATUS_RANK[sDeepestStatus] ?? 0;
  const dtApplied = finalRank >= 1 ? existing.dtApplied ?? now : null;
  const dtFirstResponse = finalRank >= 2 ? existing.dtFirstResponse ?? now : null;

  const db = await getDb();
  await db.run(
    "UPDATE Job SET sStatus = ?, sDeepestStatus = ?, dtApplied = ?, dtFirstResponse = ?, dtUpdateDateTime = ?"
      + (sNote ? ", sNote = ?" : "")
      + " WHERE uuid = ?",
    sNote
      ? [sStatus, sDeepestStatus, dtApplied, dtFirstResponse, now, sNote, uuid]
      : [sStatus, sDeepestStatus, dtApplied, dtFirstResponse, now, uuid],
  );

  return {
    ...existing,
    sStatus,
    sDeepestStatus,
    dtApplied,
    dtFirstResponse,
    dtUpdateDateTime: now,
    sNote: sNote || existing.sNote,
  };
}

const PATCHABLE: Record<string, string> = {
  sNote: "sNote",
  sCoverLetterPath: "sCoverLetterPath",
  sSourceUrl: "sSourceUrl",
  sLocation: "sLocation",
  sContractType: "sContractType",
  sJobRequirement: "sJobRequirement",
  sCompany: "sCompany",
  sJobTitle: "sJobTitle",
};

export type JobPatch = Partial<Pick<Job, "sNote" | "sCoverLetterPath" | "sSourceUrl" | "sLocation" | "sContractType" | "sJobRequirement" | "sCompany" | "sJobTitle">>;

export async function updateJobFields(uuid: string, patch: JobPatch): Promise<Job> {
  const existing = await getJob(uuid);
  if (!existing) throw new Error("Job not found: " + uuid);

  const sets: string[] = [];
  const params: Array<string | null> = [];
  for (const [key, column] of Object.entries(PATCHABLE)) {
    const value = patch[key as keyof JobPatch];
    if (value === undefined) continue;
    sets.push(column + " = ?");
    params.push(value as string | null);
  }
  if (!sets.length) return existing;

  const db = await getDb();
  const now = new Date().toISOString();
  sets.push("dtUpdateDateTime = ?");
  params.push(now, uuid);
  await db.run("UPDATE Job SET " + sets.join(", ") + " WHERE uuid = ?", params);

  return { ...existing, ...patch, dtUpdateDateTime: now } as Job;
}

/** Soft delete by default — bDelete is in the schema so nothing is really lost. */
/** Attach the generated letter to a job, and flag the row if the letter had a problem. */
export async function setCoverLetter(
  uuid: string,
  sCoverLetterPath: string | null,
  options: { bError?: boolean; sNote?: string } = {},
): Promise<Job | null> {
  const existing = await getJob(uuid);
  if (!existing) return null;

  const db = await getDb();
  const now = new Date().toISOString();
  const bError = options.bError ?? existing.bError;
  const sNote = options.sNote ?? existing.sNote;

  await db.run(
    "UPDATE Job SET sCoverLetterPath = ?, bError = ?, sNote = ?, dtUpdateDateTime = ? WHERE uuid = ?",
    [sCoverLetterPath, bError ? 1 : 0, sNote, now, uuid],
  );
  return { ...existing, sCoverLetterPath, bError, sNote, dtUpdateDateTime: now };
}

export async function deleteJob(uuid: string, hard = false): Promise<boolean> {
  const db = await getDb();
  if (hard) {
    const removed = await db.run("DELETE FROM Job WHERE uuid = ?", [uuid]);
    return removed.changes > 0;
  }
  const result = await db.run(
    "UPDATE Job SET bDelete = 1, dtUpdateDateTime = ? WHERE uuid = ? AND bDelete = 0",
    [new Date().toISOString(), uuid],
  );
  return result.changes > 0;
}

export async function restoreJob(uuid: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run(
    "UPDATE Job SET bDelete = 0, dtUpdateDateTime = ? WHERE uuid = ? AND bDelete = 1",
    [new Date().toISOString(), uuid],
  );
  return result.changes > 0;
}

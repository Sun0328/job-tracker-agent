import { getDb } from "@/infra/db";
import {
  createJob, deleteJob, getJob, listJobs, updateJobFields, updateStatus,
  type CreateJobOptions, type JobFilter, type JobPatch,
} from "@/data/job-repository";
import type { ExtractedJob, Job, JobStatus } from "@/domain";
import type { Tool } from "@/agent/core/tool";

export type DbSqlInput =
  | { op: "create_job"; job: ExtractedJob; options?: CreateJobOptions }
  | { op: "get_job"; uuid: string }
  | { op: "list_jobs"; filter?: JobFilter }
  | { op: "update_job"; uuid: string; patch: JobPatch }
  | { op: "update_status"; uuid: string; sStatus: JobStatus; sNote?: string; when?: string }
  | { op: "delete_job"; uuid: string; hard?: boolean }
  | { op: "select"; sql: string; params?: Array<string | number | null>; limit?: number };

export type DbSqlOutput =
  | { op: "create_job"; job: Job }
  | { op: "get_job"; job: Job | null }
  | { op: "list_jobs"; jobs: Job[] }
  | { op: "update_job"; job: Job }
  | { op: "update_status"; job: Job }
  | { op: "delete_job"; deleted: boolean }
  | { op: "select"; rows: Record<string, unknown>[] };

/**
 * Read queries are allowed through as SQL; writes are not. An agent that can
 * emit arbitrary UPDATE/DELETE against the tracker is a bad trade for the small
 * amount of flexibility it buys, so writes go through the named operations.
 */
function assertReadOnly(sql: string) {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (/;/.test(trimmed)) throw new Error("Only one statement is allowed");
  if (!/^\s*(select|with)\b/i.test(trimmed)) throw new Error("Only SELECT queries are allowed here");
  if (/\b(insert|update|delete|drop|alter|create|attach|pragma|replace)\b/i.test(trimmed)) {
    throw new Error("Write statements are not allowed here — use a named operation");
  }
  return trimmed;
}

export const dbSql: Tool<DbSqlInput, DbSqlOutput> = {
  name: "db_sql",
  description: "Create, read, update and delete tracker records, plus read-only SELECT queries.",

  async run(input) {
    switch (input.op) {
      case "create_job":
        return { op: "create_job", job: await createJob(input.job, input.options ?? {}) };
      case "get_job":
        return { op: "get_job", job: await getJob(input.uuid) };
      case "list_jobs":
        return { op: "list_jobs", jobs: await listJobs(input.filter ?? {}) };
      case "update_job":
        return { op: "update_job", job: await updateJobFields(input.uuid, input.patch) };
      case "update_status":
        return {
          op: "update_status",
          job: await updateStatus(input.uuid, input.sStatus, input.sNote ?? "", input.when),
        };
      case "delete_job":
        return { op: "delete_job", deleted: await deleteJob(input.uuid, input.hard ?? false) };
      case "select": {
        const sql = assertReadOnly(input.sql);
        const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
        const db = await getDb();
        const bounded = /\blimit\b/i.test(sql) ? sql : sql + " LIMIT " + limit;
        return { op: "select", rows: await db.all(bounded, input.params ?? []) };
      }
      default: {
        const exhaustive: never = input;
        throw new Error("Unknown db_sql operation: " + JSON.stringify(exhaustive));
      }
    }
  },

  summarise(input, output) {
    switch (output.op) {
      case "create_job":
        return "created " + output.job.uuid + " (" + output.job.sCompany + ")";
      case "get_job":
        return output.job ? "loaded " + output.job.uuid : "not found";
      case "list_jobs":
        return output.jobs.length + " job(s)";
      case "update_job":
        return "updated " + output.job.uuid;
      case "update_status":
        return output.job.uuid + " -> " + output.job.sStatus;
      case "delete_job":
        return output.deleted ? "deleted" : "nothing to delete";
      case "select":
        return output.rows.length + " row(s)" + ("sql" in input ? " from " + input.sql.slice(0, 50) : "");
      default:
        return "ok";
    }
  },
};

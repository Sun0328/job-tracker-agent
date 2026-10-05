import { NextResponse } from "next/server";
import { z } from "zod";
import { createJob, listJobs } from "@/data/job-repository";
import { attachJobToRun } from "@/data/run-repository";
import { CONTRACT_TYPES, JOB_STATUSES } from "@/domain";
import { createJobSchema } from "@/domain/schemas";
import { demoReadOnly } from "@/server/demo";
import { failure, readJsonBody, readQuery } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filterSchema = z.object({
  sStatus: z.enum(JOB_STATUSES).optional(),
  sSource: z.string().min(1).optional(),
  sCompany: z.string().min(1).optional(),
  sContractType: z.enum(CONTRACT_TYPES).optional(),
  windowDays: z.coerce.number().int().min(1).max(3650).optional(),
  search: z.string().min(1).optional(),
  activeOnly: z.coerce.boolean().optional(),
  includeErrors: z.coerce.boolean().optional(),
  includeDeleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** List applications. Filters: status, source, company, contract type, windowDays (tracked in the last N days), search, activeOnly. */
export async function GET(request: Request) {
  const parsed = readQuery(request, filterSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const jobs = await listJobs(parsed.data);
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (error) {
    return failure(error, "Unable to load jobs");
  }
}

/** Track an analysed job by hand. */
export async function POST(request: Request) {
  const blocked = demoReadOnly();
  if (blocked) return blocked;
  const parsed = await readJsonBody(request, createJobSchema, "job");
  if (!parsed.ok) return parsed.response;

  const { sRunID, sStatus, sNote, sCoverLetterPath, ...job } = parsed.data;
  try {
    const created = await createJob(job, {
      sRunID: sRunID ?? null,
      sStatus,
      sNote,
      sCoverLetterPath: sCoverLetterPath ?? null,
    });
    if (sRunID) await attachJobToRun(sRunID, created.uuid);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return failure(error, "Unable to save job");
  }
}

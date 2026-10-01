import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteJob, getJob, restoreJob, updateJobFields, updateStatus } from "@/data/job-repository";
import { CONTRACT_TYPES, JOB_STATUSES } from "@/domain";
import { failure, jsonError, readJsonBody } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  sStatus: z.enum(JOB_STATUSES).optional(),
  sNote: z.string().max(2000).optional(),
  note: z.string().max(500).default(""),
  sCompany: z.string().min(1).optional(),
  sJobTitle: z.string().min(1).optional(),
  sLocation: z.string().max(200).nullable().optional(),
  sContractType: z.enum(CONTRACT_TYPES).optional(),
  sSourceUrl: z.string().url().nullable().optional(),
  sJobRequirement: z.string().max(8000).optional(),
  restore: z.boolean().optional(),
});

type Context = { params: Promise<{ uuid: string }> };

export async function GET(_request: Request, context: Context) {
  const { uuid } = await context.params;
  try {
    const job = await getJob(uuid);
    if (!job) return jsonError("Job not found", 404);
    return NextResponse.json({ job });
  } catch (error) {
    return failure(error, "Unable to load job");
  }
}

/** Change status (with a note), notes, cover letter, source URL, location, or restore a deleted row. */
export async function PATCH(request: Request, context: Context) {
  const { uuid } = await context.params;
  const parsed = await readJsonBody(request, patchSchema, "update");
  if (!parsed.ok) return parsed.response;

  const { sStatus, note, restore, ...fields } = parsed.data;
  try {
    if (restore) await restoreJob(uuid);
    if (Object.values(fields).some((value) => value !== undefined)) await updateJobFields(uuid, fields);
    const job = sStatus ? await updateStatus(uuid, sStatus, note) : await getJob(uuid);
    if (!job) return jsonError("Job not found", 404);
    return NextResponse.json({ job });
  } catch (error) {
    return failure(error, "Unable to update job");
  }
}

export async function DELETE(request: Request, context: Context) {
  const { uuid } = await context.params;
  const hard = new URL(request.url).searchParams.get("hard") === "1";
  try {
    const removed = await deleteJob(uuid, hard);
    if (!removed) return jsonError("Job not found", 404);
    return NextResponse.json({ deleted: uuid, hard });
  } catch (error) {
    return failure(error, "Unable to delete job");
  }
}

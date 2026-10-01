import { NextResponse } from "next/server";
import { z } from "zod";
import { getJob, updateStatus } from "@/data/job-repository";
import { JOB_STATUSES } from "@/domain";
import { failure, jsonError, readJsonBody } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sStatus: z.enum(JOB_STATUSES),
  /** Goes on the row's note. */
  sNote: z.string().max(500).default(""),
  /**
   * A move to an earlier stage clears the stages beyond it, and any move back
   * into play clears a Reject. Set false to append without correcting.
   */
  correct: z.boolean().optional(),
});

type Context = { params: Promise<{ uuid: string }> };

/** The current status of one application. */
export async function GET(_request: Request, context: Context) {
  const { uuid } = await context.params;
  try {
    const job = await getJob(uuid);
    if (!job) return jsonError("Job not found", 404);
    return NextResponse.json({
      uuid: job.uuid,
      sStatus: job.sStatus,
      dtUpdateDateTime: job.dtUpdateDateTime,
      sDeepestStatus: job.sDeepestStatus,
      dtApplied: job.dtApplied,
      dtFirstResponse: job.dtFirstResponse,
      allowed: JOB_STATUSES,
    });
  } catch (error) {
    return failure(error, "Unable to read the status");
  }
}

/**
 * Set the status to anything in the list, in either direction. Updates
 * sStatus, sDeepestStatus, dtApplied and dtFirstResponse on the row.
 */
async function setStatus(request: Request, context: Context) {
  const { uuid } = await context.params;
  const parsed = await readJsonBody(request, bodySchema, "status (sStatus must be one of " + JOB_STATUSES.join(", ") + ")");
  if (!parsed.ok) return parsed.response;

  try {
    const job = await updateStatus(uuid, parsed.data.sStatus, parsed.data.sNote, { correct: parsed.data.correct });
    return NextResponse.json({
      uuid: job.uuid,
      sStatus: job.sStatus,
      sDeepestStatus: job.sDeepestStatus,
      dtApplied: job.dtApplied,
      dtFirstResponse: job.dtFirstResponse,
      dtUpdateDateTime: job.dtUpdateDateTime,
    });
  } catch (error) {
    return failure(error, "Unable to change the status");
  }
}

export const PUT = setStatus;
export const PATCH = setStatus;
export const POST = setStatus;

import { NextResponse } from "next/server";
import { jsonError, readJsonBody } from "@/server/http";
import { analyseJob, analyseRequestSchema, serialiseAnalysis, statusForOutcome } from "@/services/analyse-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One-shot run. Use /api/agent/stream to watch the steps as they happen. */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request, analyseRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await analyseJob({ request: parsed.data, signal: request.signal });
    return NextResponse.json(serialiseAnalysis(result), { status: statusForOutcome(result.outcome) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "The agent failed", 500);
  }
}

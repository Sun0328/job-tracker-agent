import { NextResponse } from "next/server";
import { demoErrorResponse, identifyVisitor, withCookie } from "@/server/demo";
import { jsonError, readJsonBody } from "@/server/http";
import { analyseJob, analyseRequestSchema, prepareAnalysis, serialiseAnalysis, statusForOutcome } from "@/services/analyse-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One-shot run. Use /api/agent/stream to watch the steps as they happen. */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request, analyseRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { visitor, setCookie } = identifyVisitor(request);

  try {
    const prepared = await prepareAnalysis(parsed.data, visitor);
    const result = await analyseJob({ ...prepared, signal: request.signal });
    return withCookie(NextResponse.json(serialiseAnalysis(result), { status: statusForOutcome(result.outcome) }), setCookie);
  } catch (error) {
    return withCookie(demoErrorResponse(error) ?? jsonError(error instanceof Error ? error.message : "The agent failed", 500), setCookie);
  }
}

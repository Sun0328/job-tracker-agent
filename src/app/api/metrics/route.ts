import { NextResponse } from "next/server";
import { z } from "zod";
import { getDashboardMetrics } from "@/data/metrics";
import { failure, readQuery } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(3650).nullable().default(null),
});

/** The job-hunt dashboard: funnel, conversion, cadence, sources, CV match, stale applications. */
export async function GET(request: Request) {
  const parsed = readQuery(request, querySchema, "windowDays");
  if (!parsed.ok) return parsed.response;

  try {
    return NextResponse.json(await getDashboardMetrics({ windowDays: parsed.data.windowDays }));
  } catch (error) {
    return failure(error, "Unable to build metrics");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { listRuns } from "@/data/run-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filterSchema = z.object({
  sStatus: z.enum(["running", "succeeded", "failed", "rejected"]).optional(),
  bError: z.coerce.boolean().optional(),
  sJobUUID: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** History of agent runs: what was analysed, how long it took, what it cost. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = Object.fromEntries([...url.searchParams.entries()].filter(([, value]) => value !== ""));
  const parsed = filterSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid filter", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const runs = await listRuns(parsed.data);
    return NextResponse.json({ runs, count: runs.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load runs" }, { status: 500 });
  }
}

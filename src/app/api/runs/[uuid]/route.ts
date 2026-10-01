import { NextResponse } from "next/server";
import { deleteRun, getRun } from "@/data/run-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ uuid: string }> };

/** One run with every step — the replayable version of the live stream. */
export async function GET(_request: Request, context: Context) {
  const { uuid } = await context.params;
  try {
    const run = await getRun(uuid);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load run" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { uuid } = await context.params;
  try {
    const removed = await deleteRun(uuid);
    if (!removed) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ deleted: uuid });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete run" }, { status: 500 });
  }
}

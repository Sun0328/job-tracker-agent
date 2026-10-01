import { NextResponse } from "next/server";
import { getHealth } from "@/services/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Database and storage reachable, which drivers, which models. */
export async function GET() {
  const health = await getHealth();
  return NextResponse.json(health, { status: health.ok ? 200 : 503 });
}

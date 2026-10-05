import { NextResponse } from "next/server";
import { identifyVisitor, withCookie } from "@/server/demo";
import { failure } from "@/server/http";
import { demoMode, demoStatus } from "@/services/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is this the public demo, and can this visitor still run an analysis? Sets the visitor cookie. */
export async function GET(request: Request) {
  if (!demoMode()) return NextResponse.json(await demoStatus(null));
  const { visitor, setCookie } = identifyVisitor(request);
  try {
    return withCookie(NextResponse.json(await demoStatus(visitor), { headers: { "Cache-Control": "no-store" } }), setCookie);
  } catch (error) {
    return failure(error, "Unable to read the demo status");
  }
}

import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * The glue every route handler repeated: read and validate a body or a query
 * string, and turn an error into a JSON response with the right status.
 */

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** The JSON body, validated. A non-JSON body or a schema failure is a 400 with the issues. */
export async function readJsonBody<S extends z.ZodTypeAny>(request: Request, schema: S, label = "request"): Promise<Parsed<z.infer<S>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: jsonError("Request body must be JSON", 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: jsonError("Invalid " + label, 400, { issues: parsed.error.flatten() }) };
  return { ok: true, data: parsed.data };
}

/** The query string as an object, empty values dropped, validated. */
export function readQuery<S extends z.ZodTypeAny>(request: Request, schema: S, label = "filter"): Parsed<z.infer<S>> {
  const url = new URL(request.url);
  const raw = Object.fromEntries([...url.searchParams.entries()].filter(([, value]) => value !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: jsonError("Invalid " + label, 400, { issues: parsed.error.flatten() }) };
  return { ok: true, data: parsed.data };
}

/** A thrown error as a response. "X not found" errors from the repositories become 404s. */
export function failure(error: unknown, fallback: string, status = 500): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  return jsonError(message, /not found/i.test(message) ? 404 : status);
}

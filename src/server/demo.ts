import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { DEMO_MESSAGES, DemoBlockedError, demoMode, type DemoBlock, type DemoVisitor } from "@/services/demo";

/**
 * The demo's HTTP side: who the visitor is (a random id in a cookie, plus a
 * salted hash of their IP), and the responses that refuse a demo action.
 */

const COOKIE = "jp_demo";
const ONE_YEAR = 60 * 60 * 24 * 365;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export interface IdentifiedVisitor {
  visitor: DemoVisitor;
  /** Set-Cookie value when the visitor is new, null otherwise. */
  setCookie: string | null;
}

/** The visitor behind a request. A first-time visitor gets a fresh id, to be set as a cookie. */
export function identifyVisitor(request: Request): IdentifiedVisitor {
  const existing = readCookie(request, COOKIE);
  const sVisitor = existing && /^[a-f0-9-]{36}$/.test(existing) ? existing : randomUUID();
  const salt = process.env.DEMO_SECRET ?? "jobpilot-demo";
  const sIpHash = createHash("sha256").update(salt + "|" + clientIp(request)).digest("hex").slice(0, 32);
  const setCookie = existing === sVisitor
    ? null
    : COOKIE + "=" + sVisitor + "; Path=/; Max-Age=" + ONE_YEAR + "; HttpOnly; SameSite=Lax"
      + (new URL(request.url).protocol === "https:" ? "; Secure" : "");
  return { visitor: { sVisitor, sIpHash }, setCookie };
}

export function withCookie<T extends Response>(response: T, setCookie: string | null): T {
  if (setCookie) response.headers.append("Set-Cookie", setCookie);
  return response;
}

/** The refusal every demo block returns. `demo: true` lets the page show it as a demo toast. */
export function demoBlocked(block: DemoBlock): NextResponse {
  return NextResponse.json(
    { error: DEMO_MESSAGES[block], demo: true, code: "demo-" + block },
    { status: block === "read-only" ? 403 : 429 },
  );
}

/** In demo mode, refuse this action outright. Outside demo mode, null: carry on. */
export function demoReadOnly(): NextResponse | null {
  return demoMode() ? demoBlocked("read-only") : null;
}

export function demoErrorResponse(error: unknown): NextResponse | null {
  return error instanceof DemoBlockedError ? demoBlocked(error.block) : null;
}

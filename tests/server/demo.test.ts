import { afterEach, describe, expect, it, vi } from "vitest";
import { demoBlocked, demoReadOnly, identifyVisitor } from "@/server/demo";

/**
 * How the demo knows a visitor: a random id in the jp_demo cookie (one AI run
 * each) plus a salted hash of the IP (three runs per network per day). Clearing
 * the cookie makes a new visitor; the IP hash is what still counts.
 */

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function request(options: { cookie?: string; ip?: string; url?: string } = {}) {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.ip) headers.set("cf-connecting-ip", options.ip);
  return new Request(options.url ?? "https://demo.example/api/demo", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("identifyVisitor", () => {
  it("gives a first-time visitor a fresh id and a year-long HttpOnly cookie", () => {
    const { visitor, setCookie } = identifyVisitor(request({ ip: "203.0.113.7" }));
    expect(visitor.sVisitor).toMatch(/^[a-f0-9-]{36}$/);
    expect(setCookie).toBe("jp_demo=" + visitor.sVisitor + "; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure");
  });

  it("recognises a returning visitor by the cookie and sets nothing", () => {
    const { visitor, setCookie } = identifyVisitor(request({ cookie: "theme=dark; jp_demo=" + ID, ip: "203.0.113.7" }));
    expect(visitor.sVisitor).toBe(ID);
    expect(setCookie).toBeNull();
  });

  it("replaces a cookie that is not one of its ids", () => {
    const { visitor, setCookie } = identifyVisitor(request({ cookie: "jp_demo=' OR 1=1 --" }));
    expect(visitor.sVisitor).not.toBe("' OR 1=1 --");
    expect(setCookie).toContain("jp_demo=" + visitor.sVisitor);
  });

  it("leaves Secure off on plain http, so the cookie still works on localhost", () => {
    expect(identifyVisitor(request({ url: "http://localhost:3200/api/demo" })).setCookie).not.toContain("Secure");
  });

  it("stores a salted hash of the IP, never the IP: same network same hash, new cookie or not", () => {
    vi.stubEnv("DEMO_SECRET", "salt-a");
    const first = identifyVisitor(request({ ip: "203.0.113.7" })).visitor;
    const clearedCookies = identifyVisitor(request({ ip: "203.0.113.7" })).visitor;
    const otherNetwork = identifyVisitor(request({ ip: "198.51.100.4" })).visitor;

    expect(first.sIpHash).toMatch(/^[a-f0-9]{32}$/);
    expect(first.sIpHash).not.toContain("203.0.113.7");
    expect(clearedCookies.sVisitor).not.toBe(first.sVisitor);
    expect(clearedCookies.sIpHash).toBe(first.sIpHash);
    expect(otherNetwork.sIpHash).not.toBe(first.sIpHash);

    vi.stubEnv("DEMO_SECRET", "salt-b");
    expect(identifyVisitor(request({ ip: "203.0.113.7" })).visitor.sIpHash).not.toBe(first.sIpHash);
  });

  it("falls back to the first X-Forwarded-For address off Cloudflare", () => {
    const viaProxy = new Request("http://localhost/api/demo", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    expect(identifyVisitor(viaProxy).visitor.sIpHash).toBe(identifyVisitor(request({ ip: "203.0.113.7" })).visitor.sIpHash);
  });
});

describe("demo refusals", () => {
  it("answers a used run with 429 and a read-only action with 403, both marked as demo", async () => {
    const used = demoBlocked("visitor");
    expect(used.status).toBe(429);
    expect(await used.json()).toMatchObject({ demo: true, code: "demo-visitor" });

    const readOnly = demoBlocked("read-only");
    expect(readOnly.status).toBe(403);
    expect(await readOnly.json()).toMatchObject({ demo: true, code: "demo-read-only" });
  });

  it("refuses writes only in demo mode", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(demoReadOnly()).toBeNull();
    vi.stubEnv("DEMO_MODE", "1");
    expect(demoReadOnly()?.status).toBe(403);
  });
});

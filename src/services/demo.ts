import {
  claimDemoRun,
  demoUsage,
  releaseDemoRun,
  type DemoLimits,
  type DemoRefusal,
} from "@/data/demo-run-repository";
import { getFileStorage } from "@/infra/storage";

/**
 * The public demo. Not read-only: a visitor gets ONE live AI analysis, can
 * download the letter it wrote and can move applications through the
 * pipeline. Destructive or unbounded actions are refused with a message that
 * says plainly this is a demo.
 */

export function demoMode(): boolean {
  const flag = process.env.DEMO_MODE?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function demoLimits(): DemoLimits {
  const cap = Number(process.env.DEMO_DAILY_RUN_CAP);
  return { perVisitor: 1, perIpPerDay: 3, perDay: Number.isFinite(cap) && cap > 0 ? Math.round(cap) : 40 };
}

/** Who is asking. Built by the HTTP layer from a cookie and the request's IP. */
export interface DemoVisitor {
  sVisitor: string;
  sIpHash: string;
}

export type DemoBlock = DemoRefusal | "read-only";

export const DEMO_MESSAGES: Record<DemoBlock, string> = {
  visitor: "This is a demo environment: each visitor gets one AI analysis, and you have used yours. Not allowed.",
  ip: "This is a demo environment: this network has used its AI analyses for today. Not allowed.",
  daily: "This is a demo environment: today's AI analyses are all used. Please come back tomorrow.",
  "read-only": "This is a demo environment: that change is not allowed here. You can still change an application's status.",
};

export class DemoBlockedError extends Error {
  constructor(readonly block: DemoBlock) {
    super(DEMO_MESSAGES[block]);
    this.name = "DemoBlockedError";
  }
}

/** Take the visitor's one run, or throw DemoBlockedError. Returns the id to release it with. */
export async function claimRun(visitor: DemoVisitor): Promise<number> {
  const claim = await claimDemoRun(visitor.sVisitor, visitor.sIpHash, demoLimits());
  if (!claim.granted) throw new DemoBlockedError(claim.reason);
  return claim.iID;
}

/** A run that failed through no fault of the visitor goes back to them. */
export async function releaseRun(iID: number): Promise<void> {
  await releaseDemoRun(iID);
}

export interface DemoStatus {
  demo: boolean;
  /** AI analyses this visitor can still run. */
  runsLeft: number;
  /** Why runsLeft is 0, when it is. */
  message: string | null;
  /** The fictional CV, when there is one in storage. */
  resume: { sFileName: string; url: string } | null;
}

/** The demo CV: the first PDF under resume/ in the demo bucket. */
export async function demoResumeKey(): Promise<string | null> {
  const objects = await getFileStorage().list("resume/", 20);
  return objects.find((object) => /\.pdf$/i.test(object.key))?.key ?? null;
}

export async function demoStatus(visitor: DemoVisitor | null): Promise<DemoStatus> {
  if (!demoMode() || !visitor) return { demo: false, runsLeft: 0, message: null, resume: null };

  const limits = demoLimits();
  const usage = await demoUsage(visitor.sVisitor, visitor.sIpHash);
  const block: DemoBlock | null = usage.visitor >= limits.perVisitor
    ? "visitor"
    : usage.ip >= limits.perIpPerDay
      ? "ip"
      : usage.today >= limits.perDay
        ? "daily"
        : null;

  let resume: DemoStatus["resume"] = null;
  try {
    const key = await demoResumeKey();
    if (key) resume = { sFileName: key.split("/").pop() ?? key, url: "/api/demo/resume" };
  } catch {
    resume = null;
  }

  return { demo: true, runsLeft: block ? 0 : limits.perVisitor - usage.visitor, message: block ? DEMO_MESSAGES[block] : null, resume };
}

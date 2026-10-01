import { describe, expect, it } from "vitest";
import { checkRequiredFields } from "@/agent/main-agent";
import { RunTrace } from "@/agent/core/trace";
import type { ExtractedJob } from "@/domain";

const complete: ExtractedJob = {
  sCompany: "Halter",
  bAgency: false,
  sCompanyMeta: { industry: "Agritech", business: "Virtual fencing.", website_url: "https://halterhq.com" },
  sJobTitle: "QA Automation Engineer",
  sJobRequirement: "- 5 years in automation",
  sContractType: "Permanent",
  sLocation: "Auckland",
  sJobSummary: "Own the automated test strategy.",
  sSource: "SEEK",
  sSourceUrl: null,
  sTechStack: ["Playwright"],
};

describe("main agent field check", () => {
  it("passes a complete record", () => {
    const result = checkRequiredFields(complete);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.thin).toEqual([]);
  });

  it("fails when a required field is empty", () => {
    expect(checkRequiredFields({ ...complete, sCompany: "" }).missing).toEqual(["sCompany"]);
    expect(checkRequiredFields({ ...complete, sJobSummary: "   " }).missing).toEqual(["sJobSummary"]);
    expect(checkRequiredFields({ ...complete, sJobRequirement: "" }).ok).toBe(false);
  });

  it("names every missing field, so the retry is specific", () => {
    const result = checkRequiredFields({ ...complete, sCompany: "", sJobTitle: "" });
    expect(result.missing).toEqual(["sCompany", "sJobTitle"]);
  });

  it("treats a missing location or tech stack as thin, not fatal", () => {
    const result = checkRequiredFields({ ...complete, sLocation: null, sTechStack: [] });
    expect(result.ok).toBe(true);
    expect(result.thin).toEqual(["sLocation", "sTechStack"]);
  });

  it("flags an employer advert with no company detail", () => {
    expect(checkRequiredFields({ ...complete, sCompanyMeta: null }).thin).toContain("sCompanyMeta");
  });

  it("does not expect company detail on an agency advert", () => {
    const result = checkRequiredFields({ ...complete, bAgency: true, sCompanyMeta: null });
    expect(result.ok).toBe(true);
    expect(result.thin).not.toContain("sCompanyMeta");
  });
});

describe("run error flag", () => {
  const newTrace = () => new RunTrace({ sMode: "demo", sModel: null, sInputText: "an advert" });

  it("stays 0 when every step is clean", async () => {
    const trace = newTrace();
    await trace.step("extract", "Extract", async () => "ok");
    const run = trace.succeed(null);
    expect(run.bError).toBe(false);
    expect(run.sStatus).toBe("succeeded");
  });

  it("is 1 when a step reports failure without throwing", async () => {
    const trace = newTrace();
    await trace.step("validate", "Validate", async (step) => {
      step.setStatus("failed");
      return null;
    });
    const run = trace.succeed(null);
    expect(run.bError).toBe(true);
    // The run still finished, so the status and the flag say different things.
    expect(run.sStatus).toBe("succeeded");
  });

  it("is 1 when a step throws and the run fails", async () => {
    const trace = newTrace();
    await expect(trace.step("extract", "Extract", async () => {
      throw new Error("model timed out");
    })).rejects.toThrow("model timed out");

    const run = trace.fail("model timed out");
    expect(run.bError).toBe(true);
    expect(run.sStatus).toBe("failed");
    expect(run.sError).toBe("model timed out");
  });

  it("stays 0 when the input was simply not a job advert", () => {
    const trace = newTrace();
    const run = trace.reject("That does not look like a job advertisement.");
    expect(run.bError).toBe(false);
    expect(run.sStatus).toBe("rejected");
  });

  it("ignores skipped steps", async () => {
    const trace = newTrace();
    trace.skip("repair", "No repair needed");
    const run = trace.succeed(null);
    expect(run.bError).toBe(false);
  });
});

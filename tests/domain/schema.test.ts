import { describe, expect, it } from "vitest";
import { describeIssues, extractedJobSchema } from "@/domain/schemas";
import { analyseRequestSchema } from "@/services/analyse-job";
import { splitStatements } from "@/infra/db";

const base = {
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
  sTechStack: ["TypeScript"],
};

describe("extractedJobSchema", () => {
  it("accepts a clean extraction", () => {
    expect(extractedJobSchema.parse(base).sCompany).toBe("Halter");
  });

  it("treats model filler words as null rather than facts", () => {
    const parsed = extractedJobSchema.parse({ ...base, sLocation: "Not specified" });
    expect(parsed.sLocation).toBeNull();
  });

  it("normalises the source but keeps an unknown one invalid", () => {
    expect(extractedJobSchema.parse({ ...base, sSource: "seek.co.nz" }).sSource).toBe("SEEK");
    expect(extractedJobSchema.parse({ ...base, sSource: "trade me" }).sSource).toBe("Trade Me Jobs");
    expect(extractedJobSchema.safeParse({ ...base, sSource: 42 }).success).toBe(true);
  });

  it("defaults the contract type to Permanent when the advert is silent", () => {
    expect(extractedJobSchema.parse({ ...base, sContractType: null }).sContractType).toBe("Permanent");
    expect(extractedJobSchema.parse({ ...base, sContractType: "12 month fixed term" }).sContractType).toBe("Fixed-term");
    expect(extractedJobSchema.parse({ ...base, sContractType: "Full time" }).sContractType).toBe("Permanent");
  });

  it("accepts a boolean written as a string", () => {
    expect(extractedJobSchema.parse({ ...base, bAgency: "true" }).bAgency).toBe(true);
    expect(extractedJobSchema.parse({ ...base, bAgency: 0 }).bAgency).toBe(false);
  });

  it("drops company metadata on an agency advert", () => {
    expect(extractedJobSchema.parse({ ...base, bAgency: true }).sCompanyMeta).toBeNull();
  });

  it("turns a requirements list into bullet lines", () => {
    const parsed = extractedJobSchema.parse({ ...base, sJobRequirement: ["5 years testing", "Strong SQL"] });
    expect(parsed.sJobRequirement).toBe("- 5 years testing\n- Strong SQL");
  });

  it("adds a scheme to a bare domain", () => {
    const parsed = extractedJobSchema.parse({
      ...base,
      sCompanyMeta: { industry: null, business: null, website_url: "halterhq.com" },
    });
    expect(parsed.sCompanyMeta?.website_url).toBe("https://halterhq.com");
  });

  it("names the failing field so the repair prompt can be specific", () => {
    const result = extractedJobSchema.safeParse({ ...base, sCompany: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(describeIssues(result.error)[0]).toContain("sCompany");
  });
});

describe("analyseRequestSchema", () => {
  it("rejects a job post that is obviously truncated", () => {
    expect(analyseRequestSchema.safeParse({ jobPost: "QA role in Auckland" }).success).toBe(false);
  });

  it("defaults to saving and to writing a cover letter", () => {
    const parsed = analyseRequestSchema.parse({ jobPost: "x".repeat(100) });
    expect(parsed.coverLetter).toBe(true);
    expect(parsed.maxAttempts).toBe(3);
  });
});

describe("splitStatements", () => {
  it("splits on statement boundaries only", () => {
    const statements = splitStatements("CREATE TABLE a (x TEXT); -- comment; not a statement\nINSERT INTO a VALUES ('semi; colon');");
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("semi; colon");
  });
});

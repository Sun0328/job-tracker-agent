import { chat, deepSeekConfigured } from "@/infra/llm/deepseek";
import { EXTRACT_JOB_SYSTEM_PROMPT, buildRepairPrompt, buildReviewFeedbackPrompt } from "@/agent/prompts/extract-job";
import { extractedJobSchema } from "@/domain/schemas";
import { callTool, companyWebsite, jsonValidator } from "@/agent/tools";
import type { CompanyWebsiteOutput } from "@/agent/tools/company-website";
import { modelDetail } from "@/agent/core/model-detail";
import type { RunTrace } from "@/agent/core/trace";
import type { ExtractedJob } from "@/domain";

const KNOWN_TECH = [
  "TypeScript", "JavaScript", "React", "Next.js", "Node.js", "Python", "Java", "C#", ".NET", "Go", "Rust",
  "PHP", "Ruby", "Kotlin", "Swift", "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "AWS", "Azure", "GCP",
  "Docker", "Kubernetes", "Terraform", "Playwright", "Cypress", "Selenium", "Appium", "Jest", "Vitest",
  "GraphQL", "REST", "CI/CD", "Jenkins", "GitHub Actions", "Cloudflare",
];

const AGENCY_MARKERS = [
  "our client", "on behalf of our client", "recruitment", "recruiting partner", "talent solutions",
  "robert walters", "hays", "madison", "absolute it", "beyond recruitment", "potentia", "candidate",
];

export interface ExtractorOptions {
  jobPost: string;
  trace: RunTrace;
  /** 1, 2 or 3 — the main agent counts these. */
  attempt?: number;
  /** Review notes from the main agent, fed back into the prompt on a retry. */
  feedback?: string[];
  /** Look the company's own website up when the advert does not show it. */
  lookupWebsite?: boolean;
  signal?: AbortSignal;
}

export interface ExtractorResult {
  job: ExtractedJob;
  raw: string;
  issues: string[];
  repaired: boolean;
  website: CompanyWebsiteOutput | null;
  nullFields: string[];
}

/** Offline fallback so the flow is testable without an API key. */
function demoExtract(text: string): unknown {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const valueAfter = (label: string) => {
    const line = lines.find((item) => item.toLowerCase().startsWith(label.toLowerCase()));
    return line ? line.slice(line.indexOf(":") + 1).trim() || null : null;
  };
  const lower = text.toLowerCase();
  const bAgency = AGENCY_MARKERS.some((marker) => lower.includes(marker));

  return {
    sCompany: valueAfter("Company:") ?? "Unknown company",
    bAgency,
    sCompanyMeta: bAgency ? null : { industry: null, business: null, website_url: null },
    sJobTitle: valueAfter("Role:") ?? valueAfter("Title:") ?? valueAfter("Position:") ?? lines[0] ?? "Untitled role",
    sJobRequirement: lines
      .filter((line) => /(years|experience|knowledge|degree|proficien|familiar|skill|must have)/i.test(line))
      .slice(0, 8)
      .map((line) => "- " + line.replace(/^[-*•]\s*/, ""))
      .join("\n"),
    sContractType: /part.?time/i.test(text) ? "Part-time" : /fixed.?term/i.test(text) ? "Fixed-term" : /permanent|full.?time/i.test(text) ? "Permanent" : null,
    sLocation: valueAfter("Location:"),
    sJobSummary: lines.slice(0, 4).join(" ").slice(0, 420),
    sSource: lower.includes("seek.co") || lower.includes("seek.com") ? "SEEK" : lower.includes("linkedin") ? "LinkedIn" : "Other",
    sSourceUrl: /https?:\/\/\S+/.exec(text)?.[0] ?? null,
    sTechStack: KNOWN_TECH.filter((tech) => lower.includes(tech.toLowerCase())),
  };
}

/**
 * Sub-agent 1. Input: the whole advert. Output: the structured record.
 * Self-repairs one bad response; anything worse is the main agent's problem.
 */
export async function runJobExtractor(options: ExtractorOptions): Promise<ExtractorResult> {
  const { trace } = options;
  const attempt = options.attempt ?? 1;
  const live = deepSeekConfigured();
  const agent = { sAgent: "extractor" as const, iAttempt: attempt };

  const jobPost = options.jobPost;

  const raw = await trace.step(
    "extract",
    live ? "Read the advert and return structured JSON" : "Demo parser (no API key configured)",
    async (step) => {
      if (!live) {
        const demo = JSON.stringify(demoExtract(jobPost));
        step.detail({ simulated: true, responseChars: demo.length });
        return demo;
      }

      const messages = options.feedback?.length
        ? [
            { role: "system" as const, content: EXTRACT_JOB_SYSTEM_PROMPT },
            { role: "user" as const, content: jobPost },
            { role: "user" as const, content: buildReviewFeedbackPrompt("(previous attempt)", options.feedback) },
          ]
        : [
            { role: "system" as const, content: EXTRACT_JOB_SYSTEM_PROMPT },
            { role: "user" as const, content: jobPost },
          ];

      const result = await chat(messages, { json: true, temperature: 0.1, onDelta: step.delta, signal: options.signal });
      step.addUsage(result.usage);
      step.detail({
        ...modelDetail(result),
        attempt,
        promptChars: messages.reduce((total, message) => total + message.content.length, 0),
        responseChars: result.content.length,
        raw: result.content.slice(0, 4000),
      });
      return result.content;
    },
    agent,
  );

  let validated = await trace.step(
    "validate",
    "Check the JSON against the schema",
    async (step) => {
      const report = await callTool(step, jsonValidator, {
        data: raw,
        schema: extractedJobSchema,
        label: "extracted job",
        requiredNonNull: ["sCompany", "sJobTitle", "sJobSummary"],
      });
      step.detail({ valid: report.valid, issues: report.issues, nullFields: report.nullFields, missingFields: report.missingFields });
      if (!report.valid) step.setStatus("failed");
      return report;
    },
    agent,
  );

  let repaired = false;
  let rawAfterRepair = raw;

  if (!validated.valid) {
    if (!live) throw new Error("Demo parser produced invalid data: " + validated.issues.join("; "));
    trace.countRepair();
    repaired = true;

    const repair = await trace.step(
      "repair",
      "Send the validation errors back to the model",
      async (step) => {
        const result = await chat(
          [
            { role: "system", content: EXTRACT_JOB_SYSTEM_PROMPT },
            { role: "user", content: jobPost },
            { role: "assistant", content: raw },
            { role: "user", content: buildRepairPrompt(raw, validated.issues) },
          ],
          { json: true, temperature: 0, onDelta: step.delta, signal: options.signal },
        );
        step.addUsage(result.usage);

        const report = await callTool(step, jsonValidator, {
          data: result.content,
          schema: extractedJobSchema,
          label: "repaired job",
        });
        step.detail({
          ...modelDetail(result),
          issuesBefore: validated.issues,
          issuesAfter: report.issues,
          responseChars: result.content.length,
          raw: result.content.slice(0, 4000),
        });
        if (!report.valid) {
          throw new Error("Extraction failed validation after one repair: " + report.issues.join("; "));
        }
        return { report, content: result.content };
      },
      agent,
    );

    validated = repair.report;
    rawAfterRepair = repair.content;
  } else {
    trace.skip("repair", "No repair needed", { reason: "First response validated" }, "extractor");
  }

  const job = validated.value as ExtractedJob;

  // The advert rarely prints the company's own URL, so go and find it.
  let website: CompanyWebsiteOutput | null = null;
  const meta = job.sCompanyMeta;
  const needsWebsite = !job.bAgency && (!meta?.website_url || !meta?.industry || !meta?.business);

  if (needsWebsite && options.lookupWebsite !== false) {
    website = await trace.step(
      "company-lookup",
      "Find the company's own website",
      async (step) => {
        const found = await callTool(
          step,
          companyWebsite,
          {
            company: job.sCompany,
            industry: job.sCompanyMeta?.industry ?? null,
            location: job.sLocation,
            wantProfile: true,
          },
          { signal: options.signal },
        );

        step.detail({
          company: job.sCompany,
          website_url: found.website_url,
          industry: found.industry,
          business: found.business,
          profileGrounded: found.profileGrounded,
          source: found.source,
          verified: found.verified,
          reason: found.reason,
          tried: found.steps,
        });
        return found;
      },
      agent,
    ).catch(() => null);

    if (website && (website.website_url || website.industry || website.business)) {
      // The advert always wins; the lookup only fills the gaps it left.
      job.sCompanyMeta = {
        industry: job.sCompanyMeta?.industry ?? website.industry,
        business: job.sCompanyMeta?.business ?? website.business,
        website_url: job.sCompanyMeta?.website_url ?? website.website_url,
      };
    }
  } else {
    trace.skip(
      "company-lookup",
      "Website lookup not needed",
      { reason: job.bAgency ? "agency advert, no company metadata" : options.lookupWebsite === false ? "lookup disabled" : "the advert already supplied the company details" },
      "extractor",
    );
  }

  return {
    job,
    raw: rawAfterRepair,
    issues: validated.issues,
    repaired,
    website,
    nullFields: validated.nullFields,
  };
}

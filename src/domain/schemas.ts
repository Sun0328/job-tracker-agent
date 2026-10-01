import { z } from "zod";
import { CONTRACT_TYPES, JOB_SOURCES, JOB_STATUSES } from "./job";

/** "" and "unknown" are how models spell null. Treat them as null, not as facts. */
const NULL_WORDS = new Set([
  "", "n/a", "na", "none", "null", "unknown", "not specified", "not stated", "not mentioned", "-",
]);

function cleanString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return NULL_WORDS.has(text.toLowerCase()) ? null : text;
}

const nullableString = z.preprocess(cleanString, z.string().min(1).nullable());

const nullableUrl = z.preprocess((value) => {
  const text = cleanString(value);
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : "https://" + text.replace(/^\/+/, "");
}, z.string().url().nullable());

const stringList = z.preprocess((value) => {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0 && !NULL_WORDS.has(item.toLowerCase()));
}, z.array(z.string().min(1)).max(40));

/** Models answer this one as a boolean, a string, or 0/1. */
const booleanish = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(text)) return true;
  if (["false", "no", "0", "n", ""].includes(text)) return false;
  return value;
}, z.boolean());

/** A requirements list is easier for the model; the column is one block of text. */
const requirementText = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).map((item) => "- " + item.replace(/^[-*•]\s*/, "")).join("\n");
  }
  return cleanString(value) ?? "";
}, z.string().max(6000));

const sourceEnum = z.preprocess((value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "Other";
  if (text.includes("seek")) return "SEEK";
  if (text.includes("linkedin")) return "LinkedIn";
  if (text.includes("trade me") || text.includes("trademe")) return "Trade Me Jobs";
  if (text.includes("company") || text.includes("career") || text.includes("official")) return "Company Website";
  return JOB_SOURCES.find((source) => source.toLowerCase() === text) ?? "Other";
}, z.enum(JOB_SOURCES));

/**
 * Adverts say "full time", "fixed term", "12 month contract" — map them onto the
 * fixed list. Most New Zealand adverts simply do not state it, and permanent is
 * what they mean, so that is the default rather than null.
 */
const contractTypeEnum = z.preprocess((value) => {
  const text = cleanString(value)?.toLowerCase();
  if (!text) return "Permanent";
  if (text.includes("intern")) return "Internship";
  if (text.includes("casual")) return "Casual";
  if (text.includes("part")) return "Part-time";
  if (text.includes("fixed") || text.includes("fix-term") || text.includes("fix term")) return "Fixed-term";
  if (text.includes("contract")) return "Contract";
  if (text.includes("permanent") || text.includes("full")) return "Permanent";
  return CONTRACT_TYPES.find((type) => type.toLowerCase() === text) ?? "Permanent";
}, z.enum(CONTRACT_TYPES));

export const companyMetaSchema = z.object({
  industry: nullableString,
  business: z.preprocess(cleanString, z.string().max(400).nullable()),
  website_url: nullableUrl,
});

/** The contract sub-agent 1 must satisfy. */
export const extractedJobSchema = z
  .object({
    sCompany: z.string().trim().min(1, "sCompany is required"),
    bAgency: booleanish,
    sCompanyMeta: z.preprocess((value) => (value == null ? null : value), companyMetaSchema.nullable()),
    sJobTitle: z.string().trim().min(1, "sJobTitle is required"),
    sJobRequirement: requirementText,
    sContractType: contractTypeEnum,
    sLocation: nullableString,
    sJobSummary: z.string().trim().min(1, "sJobSummary is required").max(1200),
    sSource: sourceEnum,
    sSourceUrl: nullableUrl,
    sTechStack: stringList,
  })
  // Her rule: a recruitment agency advert carries no company metadata.
  .transform((job) => (job.bAgency ? { ...job, sCompanyMeta: null } : job));

/** What the API accepts to track a job by hand. */
export const createJobSchema = extractedJobSchema.and(
  z.object({
    sCoverLetterPath: z.string().min(1).nullable().optional(),
    sRunID: z.string().min(1).optional(),
    sStatus: z.enum(JOB_STATUSES).optional(),
    sNote: z.string().max(2000).optional(),
  }),
);

export const updateStatusSchema = z.object({
  uuid: z.string().min(1),
  sStatus: z.enum(JOB_STATUSES),
  sNote: z.string().max(500).default(""),
});

export type ExtractedJobInput = z.input<typeof extractedJobSchema>;

/** Flat, readable validation errors — these are shown in the run trace. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => (issue.path.join(".") || "(root)") + ": " + issue.message);
}

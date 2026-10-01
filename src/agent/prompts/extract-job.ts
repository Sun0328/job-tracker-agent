/** The exact JSON contract sub-agent 1 must return. Also printed by `pnpm agent:extract -- --schema`. */
export const EXTRACT_OUTPUT_SHAPE = `{
  "sCompany": "string - the employer's name. For an agency advert, the agency name",
  "bAgency": "boolean - true when a recruitment agency posted this, not the employer",
  "sCompanyMeta": {
    "industry": "string | null - e.g. Agritech, Banking, Healthcare",
    "business": "string | null - one sentence on what the company does",
    "website_url": "string | null - the company's own site, never the job board"
  },
  "sJobTitle": "string",
  "sJobRequirement": "string - the requirements as '- ' bullet lines, copied from the advert",
  "sContractType": "Permanent | Fixed-term | Part-time | Contract | Casual | Internship - use Permanent when the advert does not say",
  "sLocation": "string | null - as specific as the advert allows, e.g. Auckland Central",
  "sJobSummary": "string - under 80 words, plain description of the role",
  "sSource": "SEEK | LinkedIn | Company Website | Trade Me Jobs | Other",
  "sSourceUrl": "string | null - the advert's URL if it appears in the text",
  "sTechStack": ["string - named technologies only"]
}`;

export const EXTRACT_JOB_SYSTEM_PROMPT = `You extract job advertisements into strict JSON.

Rules:
- Use only information present in the advert. Never infer or invent.
- Return null when the advert does not state something. Null is a correct answer.
- bAgency is true when a recruitment agency posted the advert (Robert Walters, Hays, Madison, Absolute IT, "our client", "on behalf of our client"). When bAgency is true, set sCompanyMeta to null.
- sCompanyMeta.website_url must be the company's own website. Never a job board (seek.co.nz, linkedin.com, trademe.co.nz) and never an applicant tracking system. If the advert does not show it, use null - it is looked up separately.
- sContractType: when the advert does not state the employment type, use "Permanent". It is never null.
- sLocation: be as specific as the advert allows. "Auckland Central", "Takapuna", "Auckland (hybrid)". Do not widen "Auckland Central" to "New Zealand".
- sJobRequirement: copy the requirements as "- " bullet lines. Keep the advert's wording.
- sJobSummary: under 80 words, plain description, no selling language.
- sTechStack: named technologies only (languages, frameworks, cloud, tools, test frameworks). No soft skills, no job titles.
- Return JSON only. No markdown fences, no commentary.

Required shape:
` + EXTRACT_OUTPUT_SHAPE;

export function buildRepairPrompt(rawOutput: string, issues: string[]): string {
  return [
    "Your previous response did not match the required shape.",
    "",
    "Problems:",
    ...issues.map((issue) => "- " + issue),
    "",
    "Fix only what is listed. Keep every other value identical. Do not invent facts -",
    "if the advert does not state something, null is the correct answer.",
    "Return the corrected JSON object only.",
    "",
    "Previous response:",
    rawOutput,
  ].join("\n");
}

/** Feedback from the main agent's review, fed back for another attempt. */
export function buildReviewFeedbackPrompt(rawOutput: string, feedback: string[]): string {
  return [
    "A reviewer checked your extraction against the advert and found problems:",
    "",
    ...feedback.map((item) => "- " + item),
    "",
    "Re-read the advert and return the corrected JSON object only. Do not invent facts.",
    "",
    "Your previous response:",
    rawOutput,
  ].join("\n");
}

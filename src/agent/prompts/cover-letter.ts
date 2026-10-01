import type { Candidate } from "@/data/candidate-profile";
import type { ExtractedJob } from "@/domain";

/** Header, three sections and sign-off have to fit one A4 page. */
export const ONE_PAGE_WORDS = 300;

export const CHOOSE_RESUME_SYSTEM_PROMPT = `You pick which of a candidate's resumes best fits a job advertisement.

Judge on overlap of real experience: the role's main tasks, the technologies named,
and the seniority. A resume aimed at a different kind of role is a poor fit even if
it is longer or more impressive.

sReason must be comparative. Say what this resume has that the others do not, naming the
advert's requirement it answers. "It fits the role well" is not an answer. Give every
resume you did not choose its own one-line reason.

Return JSON only:
{
  "sFileName": "the file name of the best resume, exactly as given",
  "sReason": "one sentence: what this resume shows that the others do not, against this advert",
  "aRejected": [{"sFileName": "...", "sReason": "one line on what it lacks for this advert"}]
}`;

export function buildChooseResumePrompt(job: ExtractedJob, digests: string[]): string {
  return [
    "JOB",
    "Title: " + job.sJobTitle,
    "Company: " + job.sCompany,
    "Summary: " + job.sJobSummary,
    "Requirements:",
    job.sJobRequirement,
    "Technologies: " + (job.sTechStack.join(", ") || "none named"),
    "",
    "RESUMES",
    ...digests.map((digest, index) => "--- resume " + (index + 1) + " ---\n" + digest),
  ].join("\n");
}

/**
 * The model writes two sections only. Additional Information is assembled from
 * configuration, so the visa and notice facts are never paraphrased.
 */
export function buildCoverLetterSystemPrompt(wordLimit = ONE_PAGE_WORDS): string {
  return `You write two sections of a cover letter. It is read by HR, not engineers.

Plain everyday words. Short sentences. No jargon, no acronyms the advert did not use.

Return JSON only:
{
  "aIntroduction": ["paragraph one", "paragraph two"],
  "sWhyGoodFit": "three to four sentences"
}

aIntroduction is two paragraphs:
  1. The candidate's own background, taken from the standing highlights: the working
     principle, the move into tech, the degree, the current role. Keep it to two or
     three sentences and keep their voice.
  2. Why this role. Name the role and the company, and say plainly what draws them to
     it. Mention something specific about the company ONLY if you were given a fact
     about it, and never invent one.

sWhyGoodFit is three or four sentences of prose, no bullet points. Build it like this:

  1. Read the advert and pick the three things it asks for most clearly.
  2. Write one sentence per requirement. Each sentence must name what the role needs and
     then the specific thing the candidate has already done that proves it.
  3. Close with one sentence only if it adds something the first three did not.

This section is not a summary of the resume. A sentence that lists duties in resume order,
or that could be pasted into an application for a different job unchanged, is the wrong
sentence — rewrite it around the requirement it answers. Use the advert's own plain words
for the requirement, then the evidence from the resume or the standing highlights. Vary the
sentence shapes so it does not read as a formula. No invented experience, no invented
numbers, and never claim experience the resume does not show.

Wrong: "At SnapInspect I investigate production issues, build integrations with REST APIs
and work with AWS Lambda daily."
Right: "The role centres on keeping live client systems working, which is what I do now at
SnapInspect: I trace customer-reported faults across web and mobile and restore the affected
data myself."

Hard rules:
- ${wordLimit} words in total across both sections. It has to fit on one page.
- New Zealand English. No em dashes, no headings, no markdown, no bullet characters.
- Never write "I am excited to apply", "passionate", "leverage", "delve", "fast-paced
  environment", "dynamic", "proven track record", "I believe I would be a great fit",
  "align with your values".
- Do not mention visa, notice period or availability. A later section covers those.`;
}

export function buildCoverLetterPrompt(
  job: ExtractedJob,
  resumeText: string,
  highlights: string,
  candidate: Candidate,
): string {
  const companyFact = job.sCompanyMeta?.business
    ? "What the company does: " + job.sCompanyMeta.business
    : "No verified fact about the company is available. Do not write a sentence about it.";

  return [
    "CANDIDATE: " + candidate.fullName,
    "",
    "STANDING HIGHLIGHTS (background and achievements, usable in either section)",
    highlights || "(none supplied)",
    "",
    "JOB",
    "Title: " + job.sJobTitle,
    "Company: " + job.sCompany + (job.bAgency ? " (recruitment agency advertising for a client)" : ""),
    companyFact,
    job.sCompanyMeta?.industry ? "Industry: " + job.sCompanyMeta.industry : "",
    job.sLocation ? "Location: " + job.sLocation : "",
    "Summary: " + job.sJobSummary,
    "What they ask for:",
    job.sJobRequirement,
    "Technologies named: " + (job.sTechStack.join(", ") || "none"),
    "",
    "RESUME (the main source of facts about the candidate)",
    resumeText.slice(0, 6000),
  ].filter(Boolean).join("\n");
}

export function buildShortenPrompt(introduction: string[], whyGoodFit: string, wordLimit: number): string {
  return [
    "This letter runs onto a second page. Cut it to under " + wordLimit + " words in total.",
    "Keep the same two introduction paragraphs and the same three to four sentence fit section.",
    "Cut detail, not structure. Return the same JSON shape.",
    "",
    JSON.stringify({ aIntroduction: introduction, sWhyGoodFit: whyGoodFit }, null, 2),
  ].join("\n");
}

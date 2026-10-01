import type { RunTrace } from "@/agent/core/trace";
import { NotAJobPostError, tidyJobPost, type JobPostVerdict } from "@/agent/input";
import { runCoverLetterAgent, type CoverLetterResult } from "@/agent/steps/cover-letter";
import { runIdentify } from "@/agent/steps/identify";
import { runJobExtractor } from "@/agent/steps/job-extractor";
import { createJob, setCoverLetter } from "@/data/job-repository";
import { NoResumeError } from "@/data/resume-repository";
import { saveRun } from "@/data/run-repository";
import type { AgentRun, ExtractedJob, Job } from "@/domain";

/** Fields the tracker cannot work without. A null here means another attempt. */
const REQUIRED_FIELDS: Array<keyof ExtractedJob> = [
  "sCompany",
  "sJobTitle",
  "sJobSummary",
  "sJobRequirement",
  "sContractType",
  "sSource",
];

/** Missing these is worth saying out loud, but not worth another model call. */
const EXPECTED_FIELDS: Array<keyof ExtractedJob> = ["sLocation", "sTechStack"];

export interface MainAgentOptions {
  jobPost: string;
  trace: RunTrace;
  /** Run sub-agent 2 as well. Default true. */
  coverLetter?: boolean;
  /** Write the application and the letter to the database. Default false. */
  save?: boolean;
  lookupWebsite?: boolean;
  /** Attempts at sub-agent 1 before giving up. Default 3, hard ceiling 3. */
  maxAttempts?: number;
  /** Set false in tests to leave the database alone. */
  archiveRun?: boolean;
  signal?: AbortSignal;
}

export type MainAgentOutcome = "not-a-job-post" | "succeeded" | "failed";

export interface MainAgentResult {
  outcome: MainAgentOutcome;
  /** Present when the input was not a job advert. */
  verdict: JobPostVerdict | null;
  job: ExtractedJob | null;
  letter: CoverLetterResult | null;
  saved: Job | null;
  attempts: number;
  warnings: string[];
  error: string | null;
  /** The archived run. bError is 1 when the run failed or any step inside it did. */
  run: AgentRun;
}

interface FieldCheck {
  ok: boolean;
  missing: string[];
  thin: string[];
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The final check: the fields that must carry a value actually do. */
export function checkRequiredFields(job: ExtractedJob): FieldCheck {
  const missing = REQUIRED_FIELDS.filter((field) => isEmpty(job[field])).map(String);
  const thin = EXPECTED_FIELDS.filter((field) => isEmpty(job[field])).map(String);

  // An employer advert with no company detail at all is worth another look.
  if (!job.bAgency && !job.sCompanyMeta) thin.push("sCompanyMeta");
  return { ok: missing.length === 0, missing, thin };
}

/** Enough of a record to store when extraction never produced one. */
function blankJob(): ExtractedJob {
  return {
    sCompany: "(unknown)",
    bAgency: false,
    sCompanyMeta: null,
    sJobTitle: "(extraction failed)",
    sJobRequirement: "",
    sContractType: "Permanent",
    sLocation: null,
    sJobSummary: "",
    sSource: "Other",
    sSourceUrl: null,
    sTechStack: [],
  };
}

async function persistJob(
  job: ExtractedJob,
  sRunID: string,
  sCoverLetterPath: string | null,
  bError: boolean,
  sNote: string,
  warnings: string[],
): Promise<Job | null> {
  try {
    return await createJob(job, { sRunID, sCoverLetterPath, bError, sNote });
  } catch (error) {
    warnings.push("Could not save the row: " + (error instanceof Error ? error.message : String(error)));
    return null;
  }
}

/**
 * The main agent. It decides whether the input is a job advert at all, runs
 * the extractor and the cover-letter writer, checks their output, and retries a
 * step with the specific problem rather than looping blindly.
 */
export async function runMainAgent(options: MainAgentOptions): Promise<MainAgentResult> {
  const { trace } = options;
  const jobPost = tidyJobPost(options.jobPost);
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 3);
  const warnings: string[] = [];

  /** Every exit path archives the run, so a failure is as visible as a success. */
  const archive = async (run: AgentRun): Promise<AgentRun> => {
    if (options.archiveRun === false) return run;
    try {
      await saveRun(run);
    } catch (error) {
      warnings.push("Run was not archived: " + (error instanceof Error ? error.message : String(error)));
    }
    return run;
  };

  // 1. Is this a job advertisement at all? Nothing else runs until it says yes.
  const verdict = await runIdentify({ jobPost, trace, signal: options.signal });

  if (verdict && !verdict.bIsJobPost) {
    const message = new NotAJobPostError(verdict).message;
    return {
      outcome: "not-a-job-post", verdict, job: null, letter: null, saved: null,
      attempts: 0, warnings, error: message, run: await archive(trace.reject(message)),
    };
  }

  // 2. Sub-agent 1, checked and retried with the specific problem.
  let job: ExtractedJob | null = null;
  let partial: ExtractedJob | null = null;
  let attempts = 0;
  let feedback: string[] = [];
  let lastIssue: string | null = null;

  while (attempts < maxAttempts && !job) {
    attempts += 1;
    let extracted: ExtractedJob;

    try {
      const result = await runJobExtractor({
        jobPost,
        trace,
        attempt: attempts,
        feedback,
        lookupWebsite: options.lookupWebsite,
        signal: options.signal,
      });
      extracted = result.job;
      partial = result.job;
    } catch (error) {
      lastIssue = error instanceof Error ? error.message : String(error);
      feedback = ["The previous attempt failed: " + lastIssue];
      continue;
    }

    const check = await trace.step(
      "check-fields",
      "Check the extracted record",
      async (step) => {
        const result = checkRequiredFields(extracted);
        step.detail({
          attempt: attempts,
          required: REQUIRED_FIELDS,
          missing: result.missing,
          thin: result.thin,
          ok: result.ok,
        });
        if (!result.ok) step.setStatus("failed");
        return result;
      },
      { sAgent: "main", iAttempt: attempts },
    );

    if (check.ok) {
      job = extracted;
      for (const field of check.thin) {
        warnings.push(field + " came back empty — fill it in by hand if it matters.");
      }
    } else {
      lastIssue = "missing required fields: " + check.missing.join(", ");
      feedback = check.missing.map((field) => field + " came back empty and must have a value from the advert.");
      warnings.push("Attempt " + attempts + " left " + check.missing.join(", ") + " empty.");
    }
  }

  if (!job) {
    const message = "Sub-agent 1 could not produce a complete record after " + attempts
      + " attempt(s) (" + lastIssue + ")";

    // The row still goes in, flagged, so the attempt is visible rather than lost.
    const failedRun = trace.fail(message);
    const stored = options.save === false
      ? null
      : await persistJob(partial ?? blankJob(), trace.runId, null, true, message, warnings);

    return {
      outcome: "failed", verdict: verdict ?? null, job: partial, letter: null, saved: stored,
      attempts, warnings, error: message, run: await archive(failedRun),
    };
  }

  // 3. The row goes in first, so the letter has a job to belong to.
  let saved: Job | null = null;
  if (options.save === false) {
    trace.skip("persist", "Not saved", { reason: "save=false" }, "main");
  } else {
    saved = await trace.step(
      "persist",
      "Save the application",
      async (step) => {
        const created = await createJob(job!, { sRunID: trace.runId });
        step.detail({ uuid: created.uuid, sStatus: created.sStatus, bError: created.bError });
        return created;
      },
      { sAgent: "main" },
    );
  }

  // 4. Sub-agent 2, with the job it belongs to.
  let letter: CoverLetterResult | null = null;
  if (options.coverLetter === false) {
    trace.skip("cover-letter", "Cover letter not requested", { reason: "coverLetter=false" }, "main");
  } else {
    try {
      letter = await runCoverLetterAgent({
        job,
        trace,
        sJobUUID: saved?.uuid ?? null,
        save: options.save !== false,
        signal: options.signal,
      });
      warnings.push(...letter.warnings);

      await trace.step(
        "check-letter",
        "Check the letter before it goes out",
        async (step) => {
          const problems: string[] = [];
          if (letter!.pages !== 1) problems.push("it is " + letter!.pages + " pages");
          if (!/visa/i.test(letter!.text)) problems.push("the visa sentence is missing");
          if (!/notice period/i.test(letter!.text)) problems.push("the notice period sentence is missing");
          if (!letter!.sCoverLetterPath && options.save !== false) problems.push("it was not saved to storage");

          step.detail({ pages: letter!.pages, words: letter!.words, resume: letter!.resume?.sFileName, problems });
          if (problems.length) {
            step.setStatus("failed");
            warnings.push("Letter check: " + problems.join(", ") + ".");
          }

          // Point the row at its letter now that both exist.
          if (saved && letter!.sCoverLetterPath) {
            const updated = await setCoverLetter(saved.uuid, letter!.sCoverLetterPath, {
              bError: problems.length > 0,
              sNote: problems.length ? "Cover letter: " + problems.join(", ") : "",
            });
            if (updated) saved = updated;
          }
          return problems;
        },
        { sAgent: "main" },
      );
    } catch (error) {
      if (error instanceof NoResumeError) {
        warnings.push(error.message);
        trace.skip("cover-letter", "No resume in storage", { reason: error.message }, "main");
      } else {
        throw error;
      }
    }
  }

  const run = await archive(trace.succeed(
    { ...job, sCoverLetterPath: letter?.sCoverLetterPath ?? null, aWarnings: warnings },
    saved?.uuid ?? null,
  ));

  return { outcome: "succeeded", verdict: verdict ?? null, job, letter, saved, attempts, warnings, error: null, run };
}

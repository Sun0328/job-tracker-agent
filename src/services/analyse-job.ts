import { z } from "zod";
import { createRunTrace } from "@/agent/core/create-trace";
import type { RunEventHandler } from "@/agent/core/trace";
import { runMainAgent, type MainAgentOutcome, type MainAgentResult } from "@/agent/main-agent";

export type { RunEvent, RunEventHandler } from "@/agent/core/trace";
export type { MainAgentResult } from "@/agent/main-agent";

/** What both analyse routes and the CLI accept. */
export const analyseRequestSchema = z.object({
  jobPost: z.string().trim().min(80, "Paste the whole advert — this looks too short").max(60_000),
  /** Persist the result as a tracked job in the same call. */
  save: z.boolean().default(false),
  /** Run sub-agent 2 and produce the cover letter PDF. */
  coverLetter: z.boolean().default(true),
  /** Let the extractor look up the company's own website. */
  lookupWebsite: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(3).default(3),
});

export type AnalyseRequest = z.infer<typeof analyseRequestSchema>;

export interface AnalyseJobOptions {
  request: AnalyseRequest;
  /** Live step events, for the SSE stream or the terminal. */
  onEvent?: RunEventHandler;
  signal?: AbortSignal;
}

/** The use case behind POST /api/agent, its stream twin and `npm run agent`. */
export async function analyseJob({ request, onEvent, signal }: AnalyseJobOptions): Promise<MainAgentResult> {
  const trace = createRunTrace(request.jobPost, { onEvent });
  return runMainAgent({
    jobPost: request.jobPost,
    trace,
    coverLetter: request.coverLetter,
    save: request.save,
    lookupWebsite: request.lookupWebsite,
    maxAttempts: request.maxAttempts,
    signal,
  });
}

/** The wire shape of a result: the letter without its bytes, the run without its input text. */
export function serialiseAnalysis(result: MainAgentResult) {
  return {
    outcome: result.outcome,
    verdict: result.verdict,
    job: result.job,
    saved: result.saved,
    letter: result.letter
      ? {
          text: result.letter.text,
          words: result.letter.words,
          pages: result.letter.pages,
          sCoverLetterPath: result.letter.sCoverLetterPath,
          resume: result.letter.resume,
        }
      : null,
    attempts: result.attempts,
    warnings: result.warnings,
    error: result.error,
    runId: result.run.uuid,
    run: { uuid: result.run.uuid, sStatus: result.run.sStatus, bError: result.run.bError, aSteps: result.run.aSteps },
  };
}

export type AnalysisPayload = ReturnType<typeof serialiseAnalysis>;

export function statusForOutcome(outcome: MainAgentOutcome): number {
  return outcome === "succeeded" ? 200 : outcome === "not-a-job-post" ? 422 : 500;
}

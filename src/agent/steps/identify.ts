import type { RunTrace } from "@/agent/core/trace";
import type { JobPostVerdict } from "@/agent/input";
import { CLASSIFY_SYSTEM_PROMPT, buildClassifyPrompt } from "@/agent/prompts/classify";
import { chat, deepSeekConfigured } from "@/infra/llm/deepseek";

/**
 * Step 1: is this a job advertisement at all? DeepSeek answers with a verdict
 * and a reason. A null verdict means nobody could be asked, and the run carries on.
 */

export interface IdentifyOptions {
  jobPost: string;
  trace: RunTrace;
  signal?: AbortSignal;
}

/** The recorded step. Null when no model could be asked. */
export async function runIdentify({ jobPost, trace, signal }: IdentifyOptions): Promise<JobPostVerdict | null> {
  return trace.step(
    "identify",
    "Is this a job advertisement?",
    async (step) => {
      if (!deepSeekConfigured()) {
        step.detail({ skipped: "no API key — cannot ask the agent, continuing" });
        return null;
      }

      const result = await chat(
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: buildClassifyPrompt(jobPost) },
        ],
        { json: true, temperature: 0, maxTokens: 1500, signal },
      );
      step.addUsage(result.usage);

      let parsed: Partial<JobPostVerdict> = {};
      try {
        parsed = JSON.parse(result.content) as Partial<JobPostVerdict>;
      } catch {
        // An unreadable verdict must not block a real advert.
        step.detail({ unparsed: result.content.slice(0, 200), assumed: "job post" });
        return null;
      }

      const decided: JobPostVerdict = {
        bIsJobPost: parsed.bIsJobPost === true,
        sReason: parsed.sReason ?? "no reason given",
        sLooksLike: parsed.sLooksLike ?? null,
      };
      step.detail({ ...decided, model: result.model, inputChars: jobPost.length, apiMs: result.durationMs });
      if (!decided.bIsJobPost) step.setStatus("failed");
      return decided;
    },
    { sAgent: "main" },
  );
}

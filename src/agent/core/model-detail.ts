import type { ChatResult } from "@/infra/llm/deepseek";

/** Enough of the model's thinking to see why it answered; the run row stays small. */
const REASONING_CHARS = 6000;

/**
 * What every model call leaves on its step: which model, how long it took, and
 * the reasoning behind the answer, so the trace can say why, not only what.
 * The answer itself goes on the step as `raw`, exactly as the model sent it.
 */
export function modelDetail(result: ChatResult): Record<string, unknown> {
  const reasoning = result.reasoning.trim();
  return {
    model: result.model,
    apiMs: result.durationMs,
    finishReason: result.finishReason,
    reasoning: !reasoning ? null : reasoning.length > REASONING_CHARS ? reasoning.slice(0, REASONING_CHARS) + "…" : reasoning,
    reasoningChars: result.reasoningChars,
  };
}

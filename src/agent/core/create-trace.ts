import { deepSeekConfigured, deepSeekModel } from "@/infra/llm/deepseek";
import { RunTrace, type RunEventHandler } from "./trace";

/**
 * The one place that decides what mode a run is in. Every entry point (API,
 * CLI, re-rating) asked the same two env questions before this existed.
 */
export function createRunTrace(input: string, options: { onEvent?: RunEventHandler; runId?: string; sModel?: string | null } = {}): RunTrace {
  const live = deepSeekConfigured();
  return new RunTrace({
    sMode: live ? "deepseek" : "demo",
    sModel: options.sModel !== undefined ? options.sModel : live ? deepSeekModel() : null,
    sInputText: input,
    onEvent: options.onEvent,
    runId: options.runId,
  });
}

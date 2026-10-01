import type { ExtractedJob } from "./job";

/** rejected = the input was not a job advert. The agent worked; the input did not qualify. */
export type RunStatus = "running" | "succeeded" | "failed" | "rejected";
export type StepStatus = "running" | "ok" | "failed" | "skipped" | "retrying";
export type AgentName = "main" | "extractor" | "cover-letter";
export type AgentMode = "deepseek" | "demo";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** One tool call inside a step, timed and summarised. */
export interface ToolCall {
  tool: string;
  durationMs: number;
  ok: boolean;
  summary: string;
  detail: Record<string, unknown>;
}

export interface RunStep {
  iSeq: number;
  sAgent: AgentName;
  sName: string;
  sLabel: string;
  sStatus: StepStatus;
  dtDateTime: string;
  iDurationMs: number | null;
  iTokens: number;
  iAttempt: number;
  aTools: ToolCall[];
  oDetail: Record<string, unknown>;
}

/** One agent invocation, archived: the "watch the response happen" record. */
export interface AgentRun {
  uuid: string;
  dtDateTime: string;
  dtFinishDateTime: string | null;
  sStatus: RunStatus;
  sMode: AgentMode;
  sModel: string | null;
  iInputChars: number;
  sInputHash: string | null;
  sInputText: string;
  iDurationMs: number | null;
  oUsage: TokenUsage;
  iRepairCount: number;
  /** True when the run failed, or any step inside it failed. */
  bError: boolean;
  sError: string | null;
  oResult: (ExtractedJob & { sCoverLetterPath: string | null; aWarnings: string[] }) | null;
  sJobUUID: string | null;
  aSteps: RunStep[];
}

export type AgentRunSummary = Omit<AgentRun, "aSteps" | "sInputText" | "oResult"> & {
  iStepCount: number;
  sInputPreview: string;
};

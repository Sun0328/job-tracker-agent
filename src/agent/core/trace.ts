import { randomUUID, createHash } from "node:crypto";
import type { AgentMode, AgentName, AgentRun, RunStep, StepStatus, ToolCall, TokenUsage } from "@/domain";
import type { ToolRecorder } from "@/agent/core/tool";

/**
 * Everything the agents do is recorded as a step and emitted as an event. The
 * API streams the events live (that is the "watch the response happen" view) and
 * stores the finished trace so the same process can be replayed later.
 */
export type RunEvent =
  | { type: "run.start"; runId: string; dtDateTime: string; sMode: AgentMode; sModel: string | null; iInputChars: number }
  | { type: "step.start"; runId: string; iSeq: number; sAgent: AgentName; sName: string; sLabel: string; iAttempt: number; dtDateTime: string }
  | { type: "step.delta"; runId: string; iSeq: number; sAgent: AgentName; text: string }
  | { type: "step.tool"; runId: string; iSeq: number; sAgent: AgentName; call: ToolCall }
  | { type: "step.end"; runId: string; iSeq: number; sAgent: AgentName; sName: string; sLabel: string; sStatus: StepStatus; iDurationMs: number; iTokens: number; iAttempt: number; aTools: ToolCall[]; oDetail: Record<string, unknown> }
  | { type: "run.end"; runId: string; sStatus: AgentRun["sStatus"]; iDurationMs: number; oUsage: TokenUsage; run: AgentRun }
  | { type: "run.error"; runId: string; message: string };

export type RunEventHandler = (event: RunEvent) => void;

export interface StepContext extends ToolRecorder {
  /** Merge facts into the step record: prompt size, raw output, validation errors. */
  detail(patch: Record<string, unknown>): void;
  /** Count tokens this step spent. */
  addUsage(usage: Partial<TokenUsage>): void;
  /** Stream partial model output to the caller. */
  delta(text: string): void;
  /** Record a non-throwing outcome, e.g. a review that failed and will be retried. */
  setStatus(status: StepStatus): void;
}

export interface StepOptions {
  sAgent?: AgentName;
  iAttempt?: number;
}

const EMPTY_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

export function hashInput(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export class RunTrace {
  readonly runId: string;
  readonly dtDateTime: string;
  readonly sMode: AgentMode;
  readonly sModel: string | null;
  readonly sInputText: string;

  private readonly onEvent: RunEventHandler;
  private readonly startedAtMs = Date.now();
  private readonly steps: RunStep[] = [];
  private usage: TokenUsage = { ...EMPTY_USAGE };
  private repairCount = 0;

  constructor(options: { sMode: AgentMode; sModel: string | null; sInputText: string; onEvent?: RunEventHandler; runId?: string }) {
    this.runId = options.runId ?? randomUUID();
    this.dtDateTime = new Date().toISOString();
    this.sMode = options.sMode;
    this.sModel = options.sModel;
    this.sInputText = options.sInputText;
    this.onEvent = options.onEvent ?? (() => {});

    this.emit({
      type: "run.start",
      runId: this.runId,
      dtDateTime: this.dtDateTime,
      sMode: this.sMode,
      sModel: this.sModel,
      iInputChars: this.sInputText.length,
    });
  }

  private emit(event: RunEvent) {
    try {
      this.onEvent(event);
    } catch {
      // A broken listener (closed SSE connection) must never fail the run.
    }
  }

  countRepair() {
    this.repairCount += 1;
  }

  /** Runs `fn` as a recorded step. A throw is recorded as a failed step and rethrown. */
  async step<T>(
    sName: string,
    sLabel: string,
    fn: (context: StepContext) => Promise<T>,
    options: StepOptions = {},
  ): Promise<T> {
    const iSeq = this.steps.length + 1;
    const sAgent = options.sAgent ?? "main";
    const iAttempt = options.iAttempt ?? 1;
    const dtDateTime = new Date().toISOString();
    const startedMs = Date.now();

    let oDetail: Record<string, unknown> = {};
    const aTools: ToolCall[] = [];
    let iTokens = 0;
    let override: StepStatus | null = null;

    this.emit({ type: "step.start", runId: this.runId, iSeq, sAgent, sName, sLabel, iAttempt, dtDateTime });

    const context: StepContext = {
      detail: (patch) => {
        oDetail = { ...oDetail, ...patch };
      },
      addUsage: (used) => {
        const prompt = used.promptTokens ?? 0;
        const completion = used.completionTokens ?? 0;
        const total = used.totalTokens ?? prompt + completion;
        this.usage = {
          promptTokens: this.usage.promptTokens + prompt,
          completionTokens: this.usage.completionTokens + completion,
          totalTokens: this.usage.totalTokens + total,
        };
        iTokens += total;
      },
      delta: (text) => {
        if (text) this.emit({ type: "step.delta", runId: this.runId, iSeq, sAgent, text });
      },
      tool: (call) => {
        aTools.push(call);
        this.emit({ type: "step.tool", runId: this.runId, iSeq, sAgent, call });
      },
      setStatus: (status) => {
        override = status;
      },
    };

    const record = (sStatus: StepStatus) => {
      const iDurationMs = Date.now() - startedMs;
      this.steps.push({ iSeq, sAgent, sName, sLabel, sStatus, dtDateTime, iDurationMs, iTokens, iAttempt, aTools, oDetail });
      this.emit({
        type: "step.end",
        runId: this.runId,
        iSeq, sAgent, sName, sLabel, sStatus, iDurationMs, iTokens, iAttempt, aTools, oDetail,
      });
    };

    try {
      const result = await fn(context);
      record(override ?? "ok");
      return result;
    } catch (error) {
      context.detail({ error: error instanceof Error ? error.message : String(error) });
      record("failed");
      throw error;
    }
  }

  /** Record a step that was deliberately not run. */
  skip(sName: string, sLabel: string, oDetail: Record<string, unknown> = {}, sAgent: AgentName = "main") {
    const iSeq = this.steps.length + 1;
    const dtDateTime = new Date().toISOString();
    this.steps.push({ iSeq, sAgent, sName, sLabel, sStatus: "skipped", dtDateTime, iDurationMs: 0, iTokens: 0, iAttempt: 1, aTools: [], oDetail });
    this.emit({
      type: "step.end",
      runId: this.runId,
      iSeq, sAgent, sName, sLabel, sStatus: "skipped", iDurationMs: 0, iTokens: 0, iAttempt: 1, aTools: [], oDetail,
    });
  }

  private build(sStatus: AgentRun["sStatus"], oResult: AgentRun["oResult"], sError: string | null, sJobUUID: string | null): AgentRun {
    return {
      uuid: this.runId,
      dtDateTime: this.dtDateTime,
      dtFinishDateTime: new Date().toISOString(),
      sStatus,
      sMode: this.sMode,
      sModel: this.sModel,
      iInputChars: this.sInputText.length,
      sInputHash: hashInput(this.sInputText),
      sInputText: this.sInputText,
      iDurationMs: Date.now() - this.startedAtMs,
      oUsage: { ...this.usage },
      iRepairCount: this.repairCount,
      // A run that limped through a failed step is not a clean run.
      bError: sStatus === "failed" || this.steps.some((step) => step.sStatus === "failed"),
      sError,
      oResult,
      sJobUUID,
      aSteps: [...this.steps],
    };
  }

  /** The input was not a job advert. Nothing went wrong, so bError stays 0. */
  reject(reason: string): AgentRun {
    const run = { ...this.build("rejected", null, reason, null), bError: false };
    this.emit({ type: "run.end", runId: this.runId, sStatus: "rejected", iDurationMs: run.iDurationMs ?? 0, oUsage: run.oUsage, run });
    return run;
  }

  succeed(oResult: AgentRun["oResult"], sJobUUID: string | null = null): AgentRun {
    const run = this.build("succeeded", oResult, null, sJobUUID);
    this.emit({ type: "run.end", runId: this.runId, sStatus: "succeeded", iDurationMs: run.iDurationMs ?? 0, oUsage: run.oUsage, run });
    return run;
  }

  fail(error: unknown, sJobUUID: string | null = null): AgentRun {
    const message = error instanceof Error ? error.message : String(error);
    const run = this.build("failed", null, message, sJobUUID);
    this.emit({ type: "run.error", runId: this.runId, message });
    this.emit({ type: "run.end", runId: this.runId, sStatus: "failed", iDurationMs: run.iDurationMs ?? 0, oUsage: run.oUsage, run });
    return run;
  }
}

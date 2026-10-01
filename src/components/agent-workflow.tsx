"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import type { StepStatus, ToolCall } from "@/domain";

/** One step as the page sees it: the stream's step.start/tool/end events folded together. */
export interface StepView {
  iSeq: number;
  sAgent: string;
  sLabel: string;
  sName: string;
  sStatus: StepStatus;
  iAttempt: number;
  iDurationMs: number | null;
  iTokens: number;
  aTools: ToolCall[];
  oDetail: Record<string, unknown>;
  /** Characters of model output streamed so far, while the step runs. */
  streamed: number;
}

/** Shown in their own sections, so the raw step data leaves them out. */
const LONG_KEYS = new Set(["raw", "reasoning", "instructions"]);

function read<T>(step: StepView, key: string): T | undefined {
  return step.oDetail?.[key] as T | undefined;
}

/** A one-line summary of what a step actually did, for the row under its label. */
function stepSummary(step: StepView): string | null {
  const value = <T,>(key: string) => read<T>(step, key);

  if (step.sStatus === "running") return step.streamed > 0 ? step.streamed + " characters so far…" : null;
  if (step.sStatus === "failed" && value<string>("error")) return value<string>("error") ?? null;
  if (step.sName === "identify") return value<string>("sReason") ?? null;
  if (step.sName === "load-resumes") return (value<string[]>("files") ?? []).join(", ") || null;
  if (step.sName === "validate") {
    const issues = value<string[]>("issues") ?? [];
    if (issues.length) return issues.join("; ");
    const nulls = value<string[]>("nullFields") ?? [];
    return nulls.length ? "null: " + nulls.join(", ") : "valid";
  }
  if (step.sName === "company-lookup") {
    const url = value<string>("website_url");
    return url ? url + " (" + value<string>("source") + ")" : (value<string>("reason") ?? null);
  }
  if (step.sName === "check-fields") {
    const missing = value<string[]>("missing") ?? [];
    return missing.length ? "missing " + missing.join(", ") : "all required fields present";
  }
  if (step.sName === "choose-resume") {
    const chose = value<string>("chose");
    return chose ? chose + (value<string>("reason") ? " — " + value<string>("reason") : "") : null;
  }
  if (step.sName === "build-pdf") return value<number>("pages") + " page, " + value<number>("words") + " words";
  if (step.sName === "save-pdf") return value<string>("path") ?? null;
  if (step.sName === "persist") return value<string>("uuid") ?? null;
  if (step.sStatus === "skipped") return value<string>("reason") ?? null;
  return value<string>("error") ?? null;
}

/** The decision in words: what the step concluded and the reason it gave. */
function stepWhy(step: StepView): string | null {
  const value = <T,>(key: string) => read<T>(step, key);
  const error = value<string>("error");

  if (step.sName === "identify") {
    if (value<string>("skipped")) return "Not checked: " + value<string>("skipped") + ".";
    if (value<string>("assumed")) return "The answer could not be read as JSON, so the text was treated as a job advert.";
    const reason = value<string>("sReason");
    if (!reason) return error ?? null;
    const verdict = value<boolean>("bIsJobPost") ? "Yes, this is a job advertisement." : "No, this is not a job advertisement.";
    const looks = value<string>("sLooksLike");
    return verdict + " " + reason + (looks && !value<boolean>("bIsJobPost") ? " It looks like " + looks + "." : "");
  }
  if (step.sName === "validate") {
    const issues = value<string[]>("issues") ?? [];
    return issues.length ? "The JSON broke the schema: " + issues.join("; ") : "Every field matched the schema.";
  }
  if (step.sName === "check-fields") {
    const missing = value<string[]>("missing") ?? [];
    const thin = value<string[]>("thin") ?? [];
    if (missing.length) return "Required fields came back empty: " + missing.join(", ") + ". The extractor is asked again.";
    return "All required fields carry a value." + (thin.length ? " Thin: " + thin.join(", ") + "." : "");
  }
  if (step.sName === "repair") {
    const before = value<string[]>("issuesBefore") ?? [];
    return before.length ? "Sent back to the model to fix: " + before.join("; ") : (value<string>("reason") ?? null);
  }
  if (step.sName === "choose-resume") {
    const chose = value<string>("chose") ?? value<string>("file");
    const reason = value<string>("reason");
    return chose ? "Chose " + chose + (reason ? ": " + reason : ".") : (error ?? null);
  }
  return error ?? value<string>("reason") ?? null;
}

/** The model's answer as it sent it: JSON when it parses, the text otherwise. */
function stepAnswer(step: StepView): unknown {
  const raw = read<string>(step, "raw");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function stepData(step: StepView): Record<string, unknown> {
  return Object.fromEntries(Object.entries(step.oDetail ?? {}).filter(([key]) => !LONG_KEYS.has(key)));
}

function duration(ms: number | null): string {
  if (ms == null) return "";
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Colour the keys, strings and numbers of pretty-printed JSON. React nodes only: nothing is parsed as HTML. */
function highlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const [whole, string, colon, literal, number] = match;
    if (string !== undefined) {
      nodes.push(<span key={key++} className={colon ? "json-key" : "json-string"}>{string}</span>);
      if (colon) nodes.push(colon);
    } else {
      nodes.push(<span key={key++} className="json-number">{literal ?? number}</span>);
    }
    last = index + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
}

function CopyButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard permission: the text is on screen to select by hand.
    }
  }

  return (
    <button type="button" className="copy-button" onClick={copy} aria-label="Copy">
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json-pre">{typeof value === "string" ? value : highlight(asText(value))}</pre>;
}

function Section({ title, copy, children }: { title: string; copy?: unknown; children: ReactNode }) {
  return (
    <section className="inspect-section">
      <div className="inspect-head">
        <h4>{title}</h4>
        {copy !== undefined ? <CopyButton value={copy} /> : null}
      </div>
      {children}
    </section>
  );
}

function StepInspector({ step }: { step: StepView }) {
  const why = stepWhy(step);
  const reasoning = read<string>(step, "reasoning");
  const answer = stepAnswer(step);
  const instructions = read<string>(step, "instructions");
  const rejected = read<Array<{ sFileName: string; sReason: string }>>(step, "rejected") ?? [];
  const model = read<string>(step, "model");

  return (
    <div className="inspect">
      <div className="inspect-meta">
        <span>{step.sAgent}</span>
        <span>step {step.iSeq}</span>
        {step.iAttempt > 1 ? <span>attempt {step.iAttempt}</span> : null}
        <span>{step.sStatus}</span>
        {step.iDurationMs != null ? <span>{duration(step.iDurationMs)}</span> : null}
        {step.iTokens ? <span>{step.iTokens} tokens</span> : null}
        {model ? <span>{model}</span> : null}
      </div>

      {step.sStatus === "running" ? (
        <p className="inspect-why muted">Working{step.streamed ? ": " + step.streamed + " characters streamed so far" : ""}…</p>
      ) : null}

      {why ? (
        <Section title="Why">
          <p className="inspect-why">{why}</p>
          {rejected.length ? (
            <ul className="inspect-list">
              {rejected.map((item) => (
                <li key={item.sFileName}>
                  <strong>{item.sFileName}</strong> not chosen: {item.sReason}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {reasoning ? (
        <Section title="How the model reasoned" copy={reasoning}>
          <pre className="inspect-text">{reasoning}</pre>
        </Section>
      ) : null}

      {answer !== undefined ? (
        <Section title={typeof answer === "string" ? "Model answer" : "Model answer (JSON)"} copy={answer}>
          <JsonView value={answer} />
        </Section>
      ) : null}

      {step.aTools.length ? (
        <Section title={"Tools used (" + step.aTools.length + ")"}>
          <div className="tool-calls">
            {step.aTools.map((call, index) => (
              <details className="tool-call" key={call.tool + index}>
                <summary>
                  <span className="tool-chip" data-ok={call.ok}>{"{" + call.tool + "}"}</span>
                  <span className="tool-call-summary">{call.summary}</span>
                  <span className="tool-call-time">{duration(call.durationMs)}</span>
                </summary>
                <div className="tool-call-body">
                  <div className="inspect-head">
                    <h4>Input</h4>
                    <CopyButton value={call.detail} />
                  </div>
                  <JsonView value={call.detail} />
                </div>
              </details>
            ))}
          </div>
        </Section>
      ) : null}

      {instructions ? (
        <details className="inspect-more">
          <summary>What it was told to check</summary>
          <pre className="inspect-text">{instructions}</pre>
        </details>
      ) : null}

      <details className="inspect-more">
        <summary>All step data</summary>
        <div className="inspect-head" style={{ marginTop: 8 }}>
          <h4>oDetail</h4>
          <CopyButton value={step} />
        </div>
        <JsonView value={stepData(step)} />
      </details>
    </div>
  );
}

/**
 * The run as a timeline. Every step is a button: open it to see why the agent
 * decided what it did, the JSON the model sent back, and each tool it called.
 */
export function AgentWorkflow({ steps, runId }: { steps: StepView[]; runId: string | null }) {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  const totalMs = steps.reduce((sum, step) => sum + (step.iDurationMs ?? 0), 0);
  const tokens = steps.reduce((sum, step) => sum + step.iTokens, 0);

  return (
    <div className="card workflow">
      <div className="card-head">
        <h2>What the agent is doing</h2>
        {steps.length ? (
          <span className="card-note">
            {steps.length} steps · {duration(totalMs)}
            {tokens ? " · " + tokens + " tok" : ""}
            {runId ? " · run " + runId.slice(0, 8) : ""}
          </span>
        ) : null}
      </div>
      <div className="workflow-body">
        {!steps.length ? (
          <p className="empty">The steps appear here as the agent works. Click any step to see its JSON and why the agent decided.</p>
        ) : (
          <ol className="flow">
            {steps.map((step) => {
              const open = openSeq === step.iSeq;
              const summary = stepSummary(step);
              return (
                <li className="flow-step" key={step.iSeq} data-open={open}>
                  <button
                    type="button"
                    className="flow-head"
                    aria-expanded={open}
                    onClick={() => setOpenSeq(open ? null : step.iSeq)}
                  >
                    <span className="flow-dot" data-status={step.sStatus} />
                    <span className="flow-main">
                      <span className="flow-title">
                        <span className="step-agent">{step.sAgent}</span>
                        {step.sLabel}
                      </span>
                      {step.aTools.length ? (
                        <span className="flow-tools">
                          {step.aTools.map((call, index) => (
                            <span className="tool-chip" data-ok={call.ok} key={call.tool + index}>
                              {"{" + call.tool + "}"}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {summary ? <span className="flow-summary">{summary}</span> : null}
                    </span>
                    <span className="flow-meta">
                      {step.sStatus === "running" ? "…" : duration(step.iDurationMs)}
                      <ChevronRight size={14} className="flow-chevron" />
                    </span>
                  </button>
                  {open ? <StepInspector step={step} /> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

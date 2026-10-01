"use client";

import { useRef, useState } from "react";
import { AlertTriangle, ClipboardPaste, FileText, Loader2, Play, RotateCcw } from "lucide-react";
import { StatusBadge } from "@/components/charts";
import { useToast } from "@/components/toast";
import type { ExtractedJob, Job } from "@/domain";

interface StepView {
  iSeq: number;
  sAgent: string;
  sLabel: string;
  sName: string;
  sStatus: "running" | "ok" | "failed" | "skipped" | "retrying";
  iDurationMs: number | null;
  iTokens: number;
  aTools: Array<{ tool: string; summary: string; ok: boolean }>;
  oDetail: Record<string, unknown>;
  streamed: number;
}

interface LetterView {
  text: string;
  words: number;
  pages: number;
  sCoverLetterPath: string | null;
  resume: { sFileName: string; sReason: string } | null;
}

interface ResultView {
  outcome: "succeeded" | "failed" | "not-a-job-post";
  verdict: { sReason: string; sLooksLike: string | null } | null;
  job: ExtractedJob | null;
  saved: Job | null;
  letter: LetterView | null;
  warnings: string[];
  error: string | null;
  runId: string;
}

/** A one-line summary of what a step actually did, for the row under its label. */
function stepDetail(step: StepView): string | null {
  const detail = step.oDetail ?? {};
  const value = <T,>(key: string) => detail[key] as T | undefined;

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
  return null;
}

export default function AgentPage() {
  const [jobPost, setJobPost] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [result, setResult] = useState<ResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const notify = useToast();

  async function paste() {
    try {
      setJobPost(await navigator.clipboard.readText());
    } catch {
      setError("The browser would not give me the clipboard. Paste with Ctrl+V instead.");
    }
  }

  function reset() {
    abort.current?.abort();
    setSteps([]);
    setResult(null);
    setError(null);
    setRunning(false);
  }

  async function run() {
    if (jobPost.trim().length < 80) {
      setError("Paste the whole advert — this looks too short.");
      return;
    }

    setRunning(true);
    setSteps([]);
    setResult(null);
    setError(null);

    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobPost, coverLetter: true, save: true }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "The agent could not be reached (" + response.status + ")");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          const line = frame.split("\n").find((item) => item.startsWith("data:"));
          if (!line) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          apply(event);
        }
      }
    } catch (caught) {
      if ((caught as Error)?.name !== "AbortError") {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        notify.error("The agent could not be reached", message);
      }
    } finally {
      setRunning(false);
    }
  }

  function apply(event: Record<string, unknown>) {
    const type = String(event.type ?? "");

    if (type === "step.start") {
      setSteps((current) => [
        ...current,
        {
          iSeq: Number(event.iSeq),
          sAgent: String(event.sAgent),
          sLabel: String(event.sLabel),
          sName: String(event.sName),
          sStatus: "running",
          iDurationMs: null,
          iTokens: 0,
          aTools: [],
          oDetail: {},
          streamed: 0,
        },
      ]);
      return;
    }

    if (type === "step.delta") {
      setSteps((current) =>
        current.map((step) =>
          step.iSeq === Number(event.iSeq)
            ? { ...step, streamed: step.streamed + String(event.text ?? "").length }
            : step,
        ),
      );
      return;
    }

    if (type === "step.tool") {
      const call = event.call as { tool: string; summary: string; ok: boolean };
      setSteps((current) =>
        current.map((step) =>
          step.iSeq === Number(event.iSeq) ? { ...step, aTools: [...step.aTools, call] } : step,
        ),
      );
      return;
    }

    if (type === "step.end") {
      const ended: StepView = {
        iSeq: Number(event.iSeq),
        sAgent: String(event.sAgent),
        sLabel: String(event.sLabel),
        sName: String(event.sName),
        sStatus: event.sStatus as StepView["sStatus"],
        iDurationMs: Number(event.iDurationMs ?? 0),
        iTokens: Number(event.iTokens ?? 0),
        aTools: (event.aTools as StepView["aTools"]) ?? [],
        oDetail: (event.oDetail as Record<string, unknown>) ?? {},
        streamed: 0,
      };
      setSteps((current) => {
        const existing = current.findIndex((step) => step.iSeq === ended.iSeq);
        if (existing < 0) return [...current, ended];
        const next = [...current];
        next[existing] = { ...ended, streamed: current[existing].streamed };
        return next;
      });
      return;
    }

    if (type === "result") {
      const outcome = event.outcome as ResultView["outcome"];
      const job = (event.job as ExtractedJob) ?? null;
      const saved = (event.saved as Job) ?? null;
      const letter = (event.letter as LetterView) ?? null;

      if (outcome === "succeeded") {
        notify.success(
          "Analysed " + (job?.sJobTitle ?? "the advert"),
          [
            job?.sCompany ? "at " + job.sCompany : null,
            letter ? "letter written" : null,
            saved ? "tracked" : null,
          ].filter(Boolean).join(" · ") || undefined,
        );
      } else if (outcome === "not-a-job-post") {
        notify.toast("info", "That is not a job advertisement", (event.verdict as ResultView["verdict"])?.sReason);
      } else {
        notify.error("The run did not finish", (event.error as string) ?? undefined);
      }

      setResult({
        outcome: event.outcome as ResultView["outcome"],
        verdict: (event.verdict as ResultView["verdict"]) ?? null,
        job: (event.job as ExtractedJob) ?? null,
        saved: (event.saved as Job) ?? null,
        letter: (event.letter as LetterView) ?? null,
        warnings: (event.warnings as string[]) ?? [],
        error: (event.error as string) ?? null,
        runId: String(event.runId ?? ""),
      });
      return;
    }

    if (type === "run.error") {
      const message = String(event.message ?? "The run failed");
      setError(message);
      notify.error("The agent failed", message);
    }
  }

  const job = result?.job;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Analyse a job advert</h1>
          <p>Paste the whole advert. The agent checks it is a job post, pulls out the record, and writes the letter.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Job advert</h2>
              <button className="button button-ghost button-small" onClick={paste} type="button">
                <ClipboardPaste size={13} />
                Paste
              </button>
            </div>
            <div className="card-body stack">
              <textarea
                className="field field-mono"
                rows={16}
                placeholder="Paste the full job advert here, clutter and all."
                value={jobPost}
                onChange={(event) => setJobPost(event.target.value)}
                disabled={running}
              />
              <div className="toolbar">
                <span className="card-note">{jobPost.length} characters</span>
                <div className="toolbar-actions">
                  <button
                    className="button button-ghost"
                    onClick={reset}
                    type="button"
                    disabled={!steps.length && !jobPost}
                  >
                    <RotateCcw size={13} />
                    Clear
                  </button>
                  <button className="button" onClick={run} disabled={running} type="button">
                    {running ? <Loader2 size={14} className="spinner" /> : <Play size={14} />}
                    {running ? "Running" : "Run the agent"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error ? (
            <div className="notice" data-tone="critical">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          {result?.outcome === "not-a-job-post" ? (
            <div className="notice" data-tone="warning">
              <AlertTriangle size={16} />
              <div>
                <strong>That does not look like a job advertisement.</strong>
                <div className="secondary" style={{ marginTop: 3 }}>
                  {result.verdict?.sReason}
                  {result.verdict?.sLooksLike ? " It looks like " + result.verdict.sLooksLike.toLowerCase() : ""}
                </div>
              </div>
            </div>
          ) : null}

          {result?.warnings.length ? (
            <div className="notice" data-tone="warning">
              <AlertTriangle size={16} />
              <div>
                {result.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>What the agent is doing</h2>
              {result?.runId ? <span className="card-note">run {result.runId.slice(0, 8)}</span> : null}
            </div>
            <div className="card-body">
              {!steps.length ? (
                <p className="empty">The steps appear here as the agent works.</p>
              ) : (
                <div className="steps">
                  {steps.map((step) => {
                    const detail = stepDetail(step);
                    return (
                      <div className="step" key={step.iSeq}>
                        <span className="step-dot" data-status={step.sStatus} />
                        <div className="step-label">
                          <span className="step-agent">{step.sAgent}</span>
                          {step.sLabel}
                          {step.aTools.map((tool, index) => (
                            <span className="step-tool" key={tool.tool + index}>
                              {" "}
                              {"{" + tool.tool + "}"}
                            </span>
                          ))}
                          {detail ? <div className="step-detail">{detail}</div> : null}
                          {step.sStatus === "running" && step.streamed > 0 ? (
                            <div className="step-detail">{step.streamed} characters so far…</div>
                          ) : null}
                        </div>
                        <span className="step-time">
                          {step.sStatus === "running"
                            ? "…"
                            : (step.iDurationMs ?? 0) + "ms" + (step.iTokens ? " · " + step.iTokens + " tok" : "")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {job ? (
            <div className="card">
              <div className="card-head">
                <h2>{job.sJobTitle}</h2>
                {result?.saved ? <StatusBadge status={result.saved.sStatus} /> : null}
              </div>
              <div className="card-body stack">
                <dl className="kv">
                  <dt>Company</dt>
                  <dd>
                    {job.sCompany}
                    {job.bAgency ? <span className="chip" style={{ marginLeft: 8 }}>agency</span> : null}
                  </dd>
                  {job.sCompanyMeta?.business ? (
                    <>
                      <dt>What they do</dt>
                      <dd>{job.sCompanyMeta.business}</dd>
                    </>
                  ) : null}
                  {job.sCompanyMeta?.industry ? (
                    <>
                      <dt>Industry</dt>
                      <dd>{job.sCompanyMeta.industry}</dd>
                    </>
                  ) : null}
                  {job.sCompanyMeta?.website_url ? (
                    <>
                      <dt>Website</dt>
                      <dd>
                        <a href={job.sCompanyMeta.website_url} target="_blank" rel="noreferrer">
                          {job.sCompanyMeta.website_url}
                        </a>
                      </dd>
                    </>
                  ) : null}
                  <dt>Location</dt>
                  <dd>{job.sLocation ?? "Not stated"}</dd>
                  <dt>Contract</dt>
                  <dd>{job.sContractType}</dd>
                  <dt>Source</dt>
                  <dd>
                    {job.sSourceUrl ? (
                      <a href={job.sSourceUrl} target="_blank" rel="noreferrer">
                        {job.sSource}
                      </a>
                    ) : (
                      job.sSource
                    )}
                  </dd>
                  <dt>Summary</dt>
                  <dd>{job.sJobSummary}</dd>
                </dl>

                {job.sTechStack.length ? (
                  <div className="chips">
                    {job.sTechStack.map((tech) => (
                      <span className="chip" key={tech}>
                        {tech}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {result?.letter ? (
            <div className="card">
              <div className="card-head">
                <h2>Cover letter</h2>
                <span className="card-note">
                  {result.letter.words} words · {result.letter.pages} page
                </span>
              </div>
              <div className="card-body stack">
                {result.letter.resume ? (
                  <div className="notice">
                    <FileText size={15} />
                    <div>
                      <strong>{result.letter.resume.sFileName}</strong>
                      <div className="secondary" style={{ marginTop: 2 }}>
                        {result.letter.resume.sReason}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="letter">{result.letter.text}</div>
                {result.letter.sCoverLetterPath ? (
                  <p className="card-note" style={{ margin: 0 }}>
                    Saved to storage as <code>{result.letter.sCoverLetterPath}</code>
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

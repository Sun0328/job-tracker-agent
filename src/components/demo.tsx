"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, FileText, FlaskConical, Github } from "lucide-react";

/**
 * The public demo, as the browser sees it. The server decides everything (is
 * this the demo, does this visitor still have their one AI run); the page only
 * asks GET /api/demo and shows the answer.
 */

export const GITHUB_URL = "https://github.com/Sun0328/job-tracker-agent";

export interface DemoStatus {
  demo: boolean;
  runsLeft: number;
  message: string | null;
  resume: { sFileName: string; url: string } | null;
}

const OFF: DemoStatus = { demo: false, runsLeft: 0, message: null, resume: null };

let pending: Promise<DemoStatus> | null = null;

function fetchStatus(force = false): Promise<DemoStatus> {
  if (!pending || force) {
    pending = fetch("/api/demo", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<DemoStatus>) : OFF))
      .catch(() => OFF);
  }
  return pending;
}

/** Demo status for this visitor. `refresh` after a run, so the count is right. */
export function useDemo(): { status: DemoStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<DemoStatus | null>(null);

  useEffect(() => {
    let live = true;
    void fetchStatus().then((value) => {
      if (live) setStatus(value);
    });
    return () => {
      live = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setStatus(await fetchStatus(true));
  }, []);

  return { status, refresh };
}

/** A thin strip under the navigation, on every page of the demo. */
export function DemoBanner() {
  const { status } = useDemo();
  if (!status?.demo) return null;
  return (
    <div className="demo-banner" role="note">
      <FlaskConical size={14} />
      <span>
        Demo environment: a fictional candidate and fictional companies. One live AI analysis per visitor.
      </span>
      <a href={GITHUB_URL} target="_blank" rel="noreferrer">
        <Github size={13} /> Source on GitHub
      </a>
    </div>
  );
}

/** The how-to on the analyse page: three clicks from an empty page to a cover letter. */
export function DemoIntro({
  status,
  onUseExample,
  exampleLoaded,
}: {
  status: DemoStatus;
  onUseExample: () => void;
  exampleLoaded: boolean;
}) {
  return (
    <div className="card demo-intro">
      <div className="card-head">
        <h2>Try the agent</h2>
        <span className="card-note">{status.runsLeft > 0 ? "1 live AI run available" : "your live AI run is used"}</span>
      </div>
      <div className="card-body stack">
        <p className="demo-lead">
          This agent reads a job advert, checks it really is one, pulls out a structured record, picks the best CV and
          writes a one-page cover letter. Every step is traced on the right.
        </p>
        <ol className="demo-steps">
          <li>
            <strong>Load the example advert.</strong> It is a fictional AI Engineer role.
          </li>
          <li>
            <strong>Click &ldquo;Run the agent&rdquo;</strong> and watch the steps. It takes about a minute.
          </li>
          <li>
            <strong>Download the cover letter</strong>, then track the application on the{" "}
            <Link href="/dashboard">dashboard</Link> and change its status.
          </li>
        </ol>
        <div className="row demo-actions">
          <button className="button" type="button" onClick={onUseExample} disabled={exampleLoaded}>
            <ClipboardCheck size={14} />
            {exampleLoaded ? "Example advert loaded" : "Use the example advert"}
          </button>
          {status.resume ? (
            <a className="button button-ghost" href={status.resume.url} target="_blank" rel="noreferrer">
              <FileText size={14} />
              The candidate&rsquo;s CV
            </a>
          ) : null}
        </div>
        {status.message ? <p className="demo-limit">{status.message}</p> : null}
      </div>
    </div>
  );
}

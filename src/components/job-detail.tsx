"use client";

import type { Job } from "@/domain";

/** Nothing recorded reads as a dash, so an empty field is obvious rather than invisible. */
const EMPTY = "—";

function value(text: string | null | undefined): string {
  return text && String(text).trim() ? String(text) : EMPTY;
}

/**
 * Only what the row cannot already show. Company name, website, agency, title,
 * contract, location, source, status and dates are all in the row above, so
 * repeating them here would just be noise.
 */
export function JobDetail({ job }: { job: Job }) {
  return (
    <div className="detail">
      <div className="detail-grid">
        <div className="detail-group">
          <h3>The company</h3>
          <dl className="detail-kv">
            <dt>Industry</dt>
            <dd>{value(job.sCompanyMeta?.industry)}</dd>
            <dt>What they do</dt>
            <dd>{value(job.sCompanyMeta?.business)}</dd>
          </dl>
        </div>

        <div className="detail-group">
          <h3>Summary</h3>
          <div className="detail-block">{value(job.sJobSummary)}</div>
        </div>
      </div>

      <div className="detail-group" style={{ marginTop: 18 }}>
        <h3>What they ask for</h3>
        <div className="detail-block">{value(job.sJobRequirement)}</div>
      </div>

      <div className="detail-group" style={{ marginTop: 18 }}>
        <h3>Tech stack</h3>
        {job.sTechStack.length ? (
          <div className="chips">
            {job.sTechStack.map((tech) => (
              <span className="chip" key={tech}>
                {tech}
              </span>
            ))}
          </div>
        ) : (
          <span className="muted">{EMPTY}</span>
        )}
      </div>
    </div>
  );
}

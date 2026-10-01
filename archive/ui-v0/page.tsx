"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, Plus, Search, Sparkles, TrendingUp } from "lucide-react";
import { JOB_STATUSES, type Job, type JobStatus } from "@/types/job";

export default function JobDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    fetch("/api/jobs")
      .then((response) => response.json())
      .then((data) => setJobs(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const applications = jobs.filter((job) => job.status !== "Saved").length;
    const responses = jobs.filter((job) => ["Screening", "Interview", "Technical Interview", "Final Interview", "Offer"].includes(job.status)).length;
    const interviews = jobs.filter((job) => ["Interview", "Technical Interview", "Final Interview", "Offer"].includes(job.status)).length;
    const offers = jobs.filter((job) => job.status === "Offer").length;
    const sources = jobs.reduce<Record<string, number>>((all, job) => ({ ...all, [job.source]: (all[job.source] ?? 0) + 1 }), {});
    return { applications, responses, interviews, offers, sources };
  }, [jobs]);

  const filtered = useMemo(() => jobs.filter((job) => {
    const matchesQuery = `${job.companyName} ${job.jobTitle}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (statusFilter === "All" || job.status === statusFilter);
  }), [jobs, query, statusFilter]);

  const rate = (value: number) => stats.applications ? Math.round(value / stats.applications * 100) : 0;
  const funnel = [
    ["Applications", stats.applications],
    ["Responses", stats.responses],
    ["Interviews", stats.interviews],
    ["Offers", stats.offers],
  ] as const;

  async function changeStatus(jobId: string, nextStatus: JobStatus) {
    const response = await fetch("/api/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, status: nextStatus, note: "Updated from dashboard" }),
    });
    if (response.ok) {
      const updated = await response.json();
      setJobs((current) => current.map((job) => job.jobId === jobId ? updated : job));
    }
  }

  return (
    <>
      <header className="dashboard-hero">
        <div>
          <div className="eyebrow">My job search</div>
          <h1>Application<br />dashboard.</h1>
          <p className="lead">Track every opportunity, see your conversion rates, and understand what is moving your search forward.</p>
        </div>
        <Link className="button" href="/new"><Sparkles size={17} /> Analyse a job</Link>
      </header>

      <div className="metric-grid">
        <div className="metric featured"><div className="metric-label">Applications</div><div className="metric-value">{stats.applications}</div><div className="metric-sub">submitted roles</div></div>
        <div className="metric"><div className="metric-label">Response rate</div><div className="metric-value">{rate(stats.responses)}%</div><div className="metric-sub">{stats.responses} positive responses</div></div>
        <div className="metric"><div className="metric-label">Interview rate</div><div className="metric-value">{rate(stats.interviews)}%</div><div className="metric-sub">{stats.interviews} interview stages</div></div>
        <div className="metric"><div className="metric-label">Offer rate</div><div className="metric-value">{rate(stats.offers)}%</div><div className="metric-sub">{stats.offers} offers received</div></div>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-title"><div><span className="panel-kicker"><TrendingUp size={13} /> Progress</span><h3>Conversion funnel</h3></div><span className="step">All time</span></div>
          {funnel.map(([label, value]) => (
            <div className="funnel-row" key={label}>
              <span>{label}</span>
              <div className="bar"><div className="bar-fill" style={{ width: `${stats.applications ? Math.max(3, value / stats.applications * 100) : 0}%` }} /></div>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-title"><div><span className="panel-kicker"><BriefcaseBusiness size={13} /> Channels</span><h3>Applications by source</h3></div></div>
          {Object.keys(stats.sources).length ? Object.entries(stats.sources).sort((a, b) => b[1] - a[1]).map(([source, count]) => <div className="source-row" key={source}><span>{source}</span><strong>{count}</strong></div>) : <p className="muted">Source performance will appear after you save applications.</p>}
        </section>
      </div>

      <section className="applications-section">
        <div className="section-head compact">
          <div><div className="eyebrow">Your pipeline</div><h2>Applications</h2></div>
          <Link className="button light" href="/new"><Plus size={17} /> Add job</Link>
        </div>
        <div className="toolbar">
          <div className="search-box"><Search size={15} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or role" /></div>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All</option>{JOB_STATUSES.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading">Loading applications…</div> : filtered.length === 0 ? (
            <div className="dashboard-empty"><BriefcaseBusiness size={28} /><strong>No applications yet</strong><p>Analyse a job and save it to start building your dashboard.</p><Link className="button" href="/new">Analyse first job</Link></div>
          ) : (
            <table>
              <thead><tr><th>Company & role</th><th>Location</th><th>Source</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>{filtered.map((job) => (
                <tr key={job.jobId}>
                  <td className="company-cell"><strong>{job.companyName}</strong><span>{job.jobTitle}</span></td>
                  <td>{job.location ?? "—"}</td>
                  <td>{job.source}</td>
                  <td><span className={`status ${job.status.toLowerCase()}`}><select aria-label={`Status for ${job.companyName}`} className="status-select" value={job.status} onChange={(event) => changeStatus(job.jobId, event.target.value as JobStatus)}>{JOB_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></span></td>
                  <td>{new Date(job.updatedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

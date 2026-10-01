"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Download, Loader2, RefreshCw } from "lucide-react";
import { StatusFilter, StatusSelect, Tile, type StatusFilterValue } from "@/components/charts";
import { PipelineSankey } from "@/components/pipeline-sankey";
import { JobDetail } from "@/components/job-detail";
import { clearCache, loadDashboard, patchCachedJob, readCache } from "@/components/dashboard-data";
import { useToast } from "@/components/toast";
import type { DashboardMetrics, Job, JobStatus } from "@/domain";

const RANGES: Array<{ label: string; days: number | null }> = [
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "All time", days: null },
];

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Local date and time, so two adverts saved the same day can still be told apart. */
function addedAt(iso: string): { date: string; time: string } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { date: iso.slice(0, 10), time: "" };
  return {
    date: at.getFullYear() + "-" + pad2(at.getMonth() + 1) + "-" + pad2(at.getDate()),
    time: pad2(at.getHours()) + ":" + pad2(at.getMinutes()),
  };
}

export default function DashboardPage() {
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [error, setError] = useState<string | null>(null);
  const notify = useToast();

  const load = useCallback(async (force = false) => {
    // Already in hand: show it without touching the network.
    if (!force) {
      const cached = readCache(windowDays);
      if (cached) {
        setMetrics(cached.metrics);
        setJobs(cached.jobs);
        setFetchedAt(cached.fetchedAt);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadDashboard(windowDays, force);
      setMetrics(snapshot.metrics);
      setJobs(snapshot.jobs);
      setFetchedAt(snapshot.fetchedAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(uuid: string, sStatus: JobStatus) {
    const previous = jobs.find((job) => job.uuid === uuid);
    setJobs((current) => current.map((job) => (job.uuid === uuid ? { ...job, sStatus } : job)));
    patchCachedJob(uuid, { sStatus });

    try {
      const response = await fetch("/api/jobs/" + uuid + "/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sStatus, sNote: "Changed from the dashboard" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "The server refused the change");

      notify.success(
        (previous?.sJobTitle ?? "Application") + " is now " + sStatus,
        previous?.sCompany ? "at " + previous.sCompany : undefined,
      );

      // The change moves the pipeline, so the cached numbers are stale.
      clearCache();
      void load(true);
    } catch (caught) {
      // Put the row back the way it was: the change did not happen.
      if (previous) {
        setJobs((current) => current.map((job) => (job.uuid === uuid ? { ...job, sStatus: previous.sStatus } : job)));
        patchCachedJob(uuid, { sStatus: previous.sStatus });
      }
      notify.error("Could not change the status", caught instanceof Error ? caught.message : String(caught));
    }
  }

  const totals = metrics?.totals;
  const rates = metrics?.rates;

  // Newest first, whatever order the rows arrived or were patched in.
  const ordered = useMemo(
    () => [...jobs].sort((a, b) => Date.parse(b.dtDateTime) - Date.parse(a.dtDateTime)),
    [jobs],
  );
  const visible = statusFilter === "all" ? ordered : ordered.filter((job) => job.sStatus === statusFilter);
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<JobStatus, number>> = {};
    for (const job of jobs) counts[job.sStatus] = (counts[job.sStatus] ?? 0) + 1;
    return counts;
  }, [jobs]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Job hunt dashboard</h1>
          <p>
            How many applications went out, and how far each one got.
            {fetchedAt ? <span className="muted"> · loaded {new Date(fetchedAt).toLocaleTimeString()}</span> : null}
          </p>
        </div>
        <div className="row">
          <div className="segmented">
            {RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                data-active={windowDays === range.days}
                onClick={() => setWindowDays(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button className="button button-ghost button-small" type="button" onClick={() => void load(true)}>
            {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="notice" data-tone="critical" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="tiles">
        <Tile label="Tracked" value={totals?.tracked ?? 0} sub="jobs saved in this period" />
        <Tile
          label="Applications sent"
          value={totals?.applied ?? 0}
          sub={
            totals?.tracked
              ? Math.round(((totals.applied ?? 0) / totals.tracked) * 100) + "% of what you saved"
              : "none yet"
          }
        />
        <Tile
          label="Got a reply"
          value={(rates?.responseRate ?? 0) + "%"}
          sub={
            rates?.medianDaysToFirstResponse != null
              ? "median " + rates.medianDaysToFirstResponse + " days"
              : "no replies yet"
          }
        />
        <Tile label="Reached interview" value={(rates?.interviewRate ?? 0) + "%"} sub="of applications sent" />
        <Tile label="Offers" value={totals?.offers ?? 0} sub={(rates?.offerRate ?? 0) + "% of applications"} />
        <Tile label="Rejected" value={totals?.rejected ?? 0} sub={(rates?.rejectionRate ?? 0) + "% of applications"} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>Where applications go</h2>
          <span className="card-note">every tracked job, and where it ended up</span>
        </div>
        <div className="card-body">
          {metrics ? (
            <div className="chart-scroll">
              <PipelineSankey pipeline={metrics.pipeline} />
            </div>
          ) : (
            <p className="empty">Loading…</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Applications</h2>
          <div className="row">
            <StatusFilter value={statusFilter} counts={statusCounts} onChange={setStatusFilter} />
            <span className="card-note">
              {statusFilter === "all" ? jobs.length + " tracked" : visible.length + " of " + jobs.length + " tracked"}
            </span>
          </div>
        </div>
        <div className="table-scroll">
          {visible.length ? (
            <table className="table">
              <colgroup>
                <col style={{ width: 38 }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: 104 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 92 }} />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  <th>Role</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Added</th>
                  <th>Status</th>
                  <th>Letter</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((job) => (
                  <Fragment key={job.uuid}>
                  <tr
                    className="row-toggle"
                    data-open={open === job.uuid}
                    onClick={() => setOpen(open === job.uuid ? null : job.uuid)}
                  >
                    <td data-label="Chevron">
                      <span className="row-chevron" data-open={open === job.uuid}>
                        <ChevronRight size={15} />
                      </span>
                    </td>
                    <td data-label="Role">
                      <div className="cell-title">{job.sJobTitle}</div>
                      <div className="cell-sub">{job.sContractType}</div>
                    </td>
                    <td data-label="Company">
                      {job.sCompanyMeta?.website_url ? (
                        <a href={job.sCompanyMeta.website_url} target="_blank" rel="noreferrer">
                          {job.sCompany}
                        </a>
                      ) : (
                        job.sCompany
                      )}
                      {job.bAgency ? <span className="cell-sub"> · agency</span> : null}
                    </td>
                    <td className="secondary" data-label="Location">{job.sLocation ?? "—"}</td>
                    <td className="secondary cell-nowrap" data-label="Source">{job.sSource}</td>
                    <td className="secondary cell-date" data-label="Added" title={job.dtDateTime}>
                      {addedAt(job.dtDateTime).date}
                      <div className="cell-sub">{addedAt(job.dtDateTime).time}</div>
                    </td>
                    <td data-label="Status" onClick={(event) => event.stopPropagation()}>
                      <StatusSelect
                        status={job.sStatus}
                        onChange={(next) => void changeStatus(job.uuid, next)}
                      />
                    </td>
                    <td data-label="Letter" onClick={(event) => event.stopPropagation()}>
                      {job.sCoverLetterPath ? (
                        <a
                          className="button button-ghost button-small"
                          href={"/api/jobs/" + job.uuid + "/cover-letter"}
                          title={job.sCoverLetterPath}
                        >
                          <Download size={13} />
                          PDF
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                  {open === job.uuid ? (
                    <tr>
                      <td colSpan={8} data-label="Detail" style={{ padding: 0 }}>
                        <JobDetail job={job} />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : jobs.length ? (
            <p className="empty">No applications with the status {statusFilter}.</p>
          ) : (
            <p className="empty">Nothing tracked yet. Analyse an advert and tick &quot;Track it&quot;.</p>
          )}
        </div>
      </div>
    </div>
  );
}

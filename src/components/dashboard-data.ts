"use client";

import type { DashboardMetrics, Job } from "@/domain";

/**
 * Module-scoped cache. Next.js keeps this module alive across client-side
 * navigation, so leaving the dashboard and coming back reads what is already
 * here instead of calling the API again. Refresh, and any change that writes to
 * the database, clear it.
 *
 * The job list and the metrics are both cached per date range, and the API
 * filters both by the same rule (tracked in the last N days). So every row the
 * table shows is a row the tiles and the graph count, and changing its status
 * always moves them.
 */
const jobsCache = new Map<string, { jobs: Job[]; fetchedAt: number }>();
const metricsCache = new Map<string, { metrics: DashboardMetrics; fetchedAt: number }>();

const key = (windowDays: number | null) => String(windowDays ?? "all");
const query = (windowDays: number | null) => (windowDays ? "windowDays=" + windowDays : "");

export interface DashboardSnapshot {
  jobs: Job[];
  metrics: DashboardMetrics;
  fetchedAt: number;
}

/** What is already in hand for this window, if anything. */
export function readCache(windowDays: number | null): DashboardSnapshot | null {
  const jobs = jobsCache.get(key(windowDays));
  const metrics = metricsCache.get(key(windowDays));
  if (!jobs || !metrics) return null;
  return { jobs: jobs.jobs, metrics: metrics.metrics, fetchedAt: Math.min(jobs.fetchedAt, metrics.fetchedAt) };
}

export function clearCache() {
  jobsCache.clear();
  metricsCache.clear();
}

async function readJson(url: string, failure: string) {
  // The dashboard is only useful if it reflects the last write, so never let the browser reuse a response.
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? failure);
  return payload;
}

/** Fetches only what is missing for this window. */
export async function loadDashboard(windowDays: number | null, force = false): Promise<DashboardSnapshot> {
  if (force) clearCache();

  const cached = readCache(windowDays);
  if (cached) return cached;

  const cacheKey = key(windowDays);
  const filter = query(windowDays);
  const needJobs = !jobsCache.has(cacheKey);
  const needMetrics = !metricsCache.has(cacheKey);

  const [jobsPayload, metricsPayload] = await Promise.all([
    needJobs ? readJson("/api/jobs?limit=200" + (filter ? "&" + filter : ""), "Could not load the applications") : null,
    needMetrics ? readJson("/api/metrics" + (filter ? "?" + filter : ""), "Could not load the metrics") : null,
  ]);

  const now = Date.now();
  if (jobsPayload) jobsCache.set(cacheKey, { jobs: jobsPayload.jobs ?? [], fetchedAt: now });
  if (metricsPayload) metricsCache.set(cacheKey, { metrics: metricsPayload, fetchedAt: now });

  const snapshot = readCache(windowDays);
  if (!snapshot) throw new Error("The dashboard data did not load");
  return snapshot;
}

/** Keep the cached row in step after an edit, in every window that holds it, without refetching. */
export function patchCachedJob(uuid: string, patch: Partial<Job>) {
  for (const [cacheKey, entry] of jobsCache) {
    jobsCache.set(cacheKey, {
      ...entry,
      jobs: entry.jobs.map((job) => (job.uuid === uuid ? { ...job, ...patch } : job)),
    });
  }
}

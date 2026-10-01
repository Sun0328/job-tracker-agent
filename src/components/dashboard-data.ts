"use client";

import type { DashboardMetrics, Job } from "@/domain";

/**
 * Module-scoped cache. Next.js keeps this module alive across client-side
 * navigation, so leaving the dashboard and coming back reads what is already
 * here instead of calling the API again. Refresh, and any change that writes to
 * the database, clear it.
 */
let jobsCache: { jobs: Job[]; fetchedAt: number } | null = null;
const metricsCache = new Map<string, { metrics: DashboardMetrics; fetchedAt: number }>();

const key = (windowDays: number | null) => String(windowDays ?? "all");

export interface DashboardSnapshot {
  jobs: Job[];
  metrics: DashboardMetrics;
  fetchedAt: number;
}

/** What is already in hand for this window, if anything. */
export function readCache(windowDays: number | null): DashboardSnapshot | null {
  const metrics = metricsCache.get(key(windowDays));
  if (!jobsCache || !metrics) return null;
  return { jobs: jobsCache.jobs, metrics: metrics.metrics, fetchedAt: Math.min(jobsCache.fetchedAt, metrics.fetchedAt) };
}

export function clearCache() {
  jobsCache = null;
  metricsCache.clear();
}

async function readJson(url: string, failure: string) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? failure);
  return payload;
}

/**
 * Fetches only what is missing. The job list does not depend on the date range,
 * so it is fetched once; the metrics are cached per range.
 */
export async function loadDashboard(windowDays: number | null, force = false): Promise<DashboardSnapshot> {
  if (force) clearCache();

  const cached = readCache(windowDays);
  if (cached) return cached;

  const metricsKey = key(windowDays);
  const needJobs = !jobsCache;
  const needMetrics = !metricsCache.has(metricsKey);

  const [jobsPayload, metricsPayload] = await Promise.all([
    needJobs ? readJson("/api/jobs?limit=200", "Could not load the applications") : null,
    needMetrics
      ? readJson("/api/metrics" + (windowDays ? "?windowDays=" + windowDays : ""), "Could not load the metrics")
      : null,
  ]);

  const now = Date.now();
  if (jobsPayload) jobsCache = { jobs: jobsPayload.jobs ?? [], fetchedAt: now };
  if (metricsPayload) metricsCache.set(metricsKey, { metrics: metricsPayload, fetchedAt: now });

  const snapshot = readCache(windowDays);
  if (!snapshot) throw new Error("The dashboard data did not load");
  return snapshot;
}

/** Keep the cached row in step after an edit, without refetching the whole list. */
export function patchCachedJob(uuid: string, patch: Partial<Job>) {
  if (!jobsCache) return;
  jobsCache = {
    ...jobsCache,
    jobs: jobsCache.jobs.map((job) => (job.uuid === uuid ? { ...job, ...patch } : job)),
  };
}

import { getDb } from "@/infra/db";
import type { Row } from "@/infra/db";
import { getPipeline } from "@/data/pipeline";
import { normaliseWindow, trackedWithin } from "@/data/window";
import { JOB_STATUSES, type DashboardMetrics, type FunnelStage, type JobStatus } from "@/domain";

const CLOSED_LIST = "('Reject', 'Offer')";
const INTERVIEW_LIST = "('HR screen', 'Tech interview', 'Behavior interview', 'Final')";
function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function days(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

function buildScript(windowDays: number | null): string {
  const within = trackedWithin(windowDays);
  const live = "bDelete = 0 AND bError = 0" + (within ? " AND " + within : "");

  /** Rank of the furthest stage reached, straight off the Job row. */
  const depth = `CASE sDeepestStatus
    WHEN 'Applied' THEN 1
    WHEN 'HR screen' THEN 2
    WHEN 'Tech interview' THEN 3
    WHEN 'Behavior interview' THEN 4
    WHEN 'Final' THEN 5
    WHEN 'Offer' THEN 6
    ELSE 0 END`;

  return [
    // 0 — current status distribution
    `SELECT sStatus, COUNT(*) AS count FROM Job WHERE ${live} GROUP BY sStatus`,

    // 1 — headline totals
    `SELECT
       COUNT(*) AS tracked,
       SUM(CASE WHEN dtApplied IS NOT NULL THEN 1 ELSE 0 END) AS applied,
       SUM(CASE WHEN sStatus NOT IN ${CLOSED_LIST} THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN sStatus IN ${INTERVIEW_LIST} THEN 1 ELSE 0 END) AS interviewing,
       SUM(CASE WHEN sStatus = 'Offer' THEN 1 ELSE 0 END) AS offers,
       SUM(CASE WHEN sStatus = 'Reject' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN sStatus = 'Applied' THEN 1 ELSE 0 END) AS awaiting_response,
       SUM(CASE WHEN bAgency = 1 THEN 1 ELSE 0 END) AS via_agency
     FROM Job WHERE ${live}`,

    // 2 — the funnel, from the furthest stage each application reached
    `SELECT
       COUNT(*) AS tracked,
       SUM(CASE WHEN ${depth} >= 1 THEN 1 ELSE 0 END) AS applied,
       SUM(CASE WHEN ${depth} >= 2 THEN 1 ELSE 0 END) AS hr_screen,
       SUM(CASE WHEN ${depth} >= 3 THEN 1 ELSE 0 END) AS tech_interview,
       SUM(CASE WHEN ${depth} >= 4 THEN 1 ELSE 0 END) AS behavior_interview,
       SUM(CASE WHEN ${depth} >= 5 THEN 1 ELSE 0 END) AS final_round,
       SUM(CASE WHEN ${depth} >= 6 THEN 1 ELSE 0 END) AS offer
     FROM Job WHERE ${live}`,

    // 3 — days from applying to the first reply
    `SELECT uuid, julianday(dtFirstResponse) - julianday(dtApplied) AS days_to_response
     FROM Job WHERE ${live} AND dtApplied IS NOT NULL AND dtFirstResponse IS NOT NULL`,

    // 4 — applications per calendar week (Monday start)
    `SELECT date(dtApplied, 'weekday 0', '-6 days') AS week, COUNT(*) AS applications
     FROM Job
     WHERE bDelete = 0 AND bError = 0 AND dtApplied IS NOT NULL
       AND datetime(dtApplied) >= datetime('now', '-84 days')
     GROUP BY week ORDER BY week ASC`,

    // 5 — replies per calendar week
    `SELECT date(dtFirstResponse, 'weekday 0', '-6 days') AS week, COUNT(*) AS responses
     FROM Job
     WHERE bDelete = 0 AND bError = 0 AND dtFirstResponse IS NOT NULL
       AND datetime(dtFirstResponse) >= datetime('now', '-84 days')
     GROUP BY week ORDER BY week ASC`,

    // 6 — which job boards actually convert
    `SELECT sSource,
       COUNT(*) AS applications,
       SUM(CASE WHEN ${depth} >= 3 THEN 1 ELSE 0 END) AS interviews,
       SUM(CASE WHEN ${depth} >= 6 THEN 1 ELSE 0 END) AS offers
     FROM Job WHERE ${live} GROUP BY sSource ORDER BY applications DESC`,

    // 7 — permanent versus contract
    `SELECT COALESCE(sContractType, 'Unknown') AS sContractType,
       COUNT(*) AS applications,
       SUM(CASE WHEN ${depth} >= 3 THEN 1 ELSE 0 END) AS interviews
     FROM Job WHERE ${live} GROUP BY sContractType ORDER BY applications DESC`,

    // 8 — where the work is
    `SELECT COALESCE(sLocation, 'Not stated') AS sLocation,
       COUNT(*) AS applications,
       SUM(CASE WHEN ${depth} >= 3 THEN 1 ELSE 0 END) AS interviews
     FROM Job WHERE ${live} GROUP BY sLocation ORDER BY applications DESC LIMIT 10`,

    // 9 — tech that keeps appearing in the adverts you chase
    `SELECT tech.value AS tech,
       COUNT(*) AS jobs,
       SUM(CASE WHEN ${depth} >= 3 THEN 1 ELSE 0 END) AS interviews
     FROM Job, json_each(Job.sTechStack) AS tech
     WHERE ${live}
     GROUP BY tech.value ORDER BY jobs DESC, tech ASC LIMIT 15`,

    // 10 — repeat companies
    `SELECT sCompany, COUNT(*) AS applications, MAX(${depth}) AS deepest
     FROM Job WHERE ${live} GROUP BY sCompany ORDER BY applications DESC, sCompany ASC LIMIT 10`,

    // 11 — sitting with no answer
    `SELECT uuid, sCompany, sJobTitle, sStatus,
       julianday('now') - julianday(dtUpdateDateTime) AS days_since_update
     FROM Job
     WHERE ${live} AND sStatus NOT IN ${CLOSED_LIST}
     ORDER BY days_since_update DESC LIMIT 10`,

    // 12 — agent health
    `SELECT
       COUNT(*) AS runs,
       SUM(CASE WHEN sStatus = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN sStatus = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN bError = 1 THEN 1 ELSE 0 END) AS errored,
       AVG(iDurationMs) AS avg_duration_ms,
       SUM(iTotalTokens) AS total_tokens
     FROM AgentRun WHERE 1 = 1${within ? " AND " + within : ""}`,
  ].join(";" + String.fromCharCode(10));
}

const STAGE_NAMES = [
  "Saved", "Applied", "HR screen", "Tech interview", "Behavior interview", "Final", "Offer",
];

function buildFunnel(row: Row): FunnelStage[] {
  const stages: Array<{ stage: string; count: number }> = [
    { stage: "Tracked", count: number(row.tracked) },
    { stage: "Applied", count: number(row.applied) },
    { stage: "HR screen", count: number(row.hr_screen) },
    { stage: "Tech interview", count: number(row.tech_interview) },
    { stage: "Behavior interview", count: number(row.behavior_interview) },
    { stage: "Final", count: number(row.final_round) },
    { stage: "Offer", count: number(row.offer) },
  ];
  const applied = number(row.applied);

  return stages.map((stage, index) => ({
    stage: stage.stage,
    count: stage.count,
    conversionFromPrevious: index === 0 ? 100 : ratio(stage.count, stages[index - 1].count),
    conversionFromApplied: ratio(stage.count, applied),
  }));
}

export interface MetricsOptions {
  /** Restrict to the last N days. Omit for all time. */
  windowDays?: number | null;
}

export async function getDashboardMetrics(options: MetricsOptions = {}): Promise<DashboardMetrics> {
  const windowDays = normaliseWindow(options.windowDays);

  const db = await getDb();
  const [results, pipeline] = await Promise.all([
    db.script(buildScript(windowDays)),
    getPipeline(windowDays),
  ]);

  const statusRows = results[0] ?? [];
  const totalsRow = (results[1] ?? [])[0] ?? {};
  const funnelRow = (results[2] ?? [])[0] ?? {};
  const responseRows = results[3] ?? [];
  const weeklyApplied = results[4] ?? [];
  const weeklyResponses = results[5] ?? [];
  const sourceRows = results[6] ?? [];
  const contractRows = results[7] ?? [];
  const locationRows = results[8] ?? [];
  const techRows = results[9] ?? [];
  const companyRows = results[10] ?? [];
  const staleRows = results[11] ?? [];
  const agentRow = (results[12] ?? [])[0] ?? {};

  const statusMap = new Map(statusRows.map((row) => [text(row.sStatus), number(row.count)]));
  const applied = number(funnelRow.applied);
  const responseDays = responseRows
    .map((row) => Number(row.days_to_response))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const weeks = new Map<string, { applications: number; responses: number }>();
  for (const row of weeklyApplied) {
    weeks.set(text(row.week), { applications: number(row.applications), responses: 0 });
  }
  for (const row of weeklyResponses) {
    const week = text(row.week);
    const existing = weeks.get(week) ?? { applications: 0, responses: 0 };
    existing.responses = number(row.responses);
    weeks.set(week, existing);
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    totals: {
      tracked: number(totalsRow.tracked),
      applied: number(totalsRow.applied),
      active: number(totalsRow.active),
      interviewing: number(totalsRow.interviewing),
      offers: number(totalsRow.offers),
      rejected: number(totalsRow.rejected),
      awaitingResponse: number(totalsRow.awaiting_response),
      viaAgency: number(totalsRow.via_agency),
    },
    rates: {
      responseRate: ratio(number(funnelRow.hr_screen), applied),
      interviewRate: ratio(number(funnelRow.tech_interview), applied),
      offerRate: ratio(number(funnelRow.offer), applied),
      rejectionRate: ratio(number(totalsRow.rejected), applied),
      avgDaysToFirstResponse: responseDays.length
        ? Math.round((responseDays.reduce((sum, value) => sum + value, 0) / responseDays.length) * 10) / 10
        : null,
      medianDaysToFirstResponse: median(responseDays),
    },
    funnel: buildFunnel(funnelRow),
    pipeline,
    statusCounts: JOB_STATUSES.map((status) => ({
      sStatus: status as JobStatus,
      count: statusMap.get(status) ?? 0,
    })),
    weeklyApplications: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, value]) => ({ week, ...value })),
    bySource: sourceRows.map((row) => ({
      sSource: text(row.sSource) || "Other",
      applications: number(row.applications),
      interviews: number(row.interviews),
      offers: number(row.offers),
      interviewRate: ratio(number(row.interviews), number(row.applications)),
    })),
    byContractType: contractRows.map((row) => ({
      sContractType: text(row.sContractType),
      applications: number(row.applications),
      interviews: number(row.interviews),
    })),
    byLocation: locationRows.map((row) => ({
      sLocation: text(row.sLocation),
      applications: number(row.applications),
      interviews: number(row.interviews),
    })),
    topTech: techRows.map((row) => ({
      tech: text(row.tech),
      jobs: number(row.jobs),
      interviews: number(row.interviews),
    })),
    topCompanies: companyRows.map((row) => ({
      sCompany: text(row.sCompany),
      applications: number(row.applications),
      deepestStage: STAGE_NAMES[Math.min(number(row.deepest), STAGE_NAMES.length - 1)] ?? "Saved",
    })),
    staleApplications: staleRows.map((row) => ({
      uuid: text(row.uuid),
      sCompany: text(row.sCompany),
      sJobTitle: text(row.sJobTitle),
      sStatus: text(row.sStatus) as JobStatus,
      daysSinceUpdate: days(row.days_since_update) ?? 0,
    })),
    agent: {
      runs: number(agentRow.runs),
      succeeded: number(agentRow.succeeded),
      failed: number(agentRow.failed),
      repairRate: ratio(number(agentRow.errored), number(agentRow.runs)),
      avgDurationMs: agentRow.avg_duration_ms == null ? null : Math.round(number(agentRow.avg_duration_ms)),
      totalTokens: number(agentRow.total_tokens),
    },
  };
}

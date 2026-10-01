import type { JobStatus } from "./job";

export interface FunnelStage {
  stage: string;
  count: number;
  conversionFromPrevious: number;
  conversionFromApplied: number;
}

/** One flow in the pipeline diagram: how many applications went from one state to the next. */
export interface PipelineLink {
  source: string;
  target: string;
  value: number;
}

export interface PipelineNode {
  name: string;
  value: number;
  /** Column position, 0 = Applied. Terminal states sit in the column after their source. */
  depth: number;
  kind: "stage" | "waiting" | "rejected" | "offer";
}

export interface Pipeline {
  nodes: PipelineNode[];
  links: PipelineLink[];
}

export interface DashboardMetrics {
  generatedAt: string;
  windowDays: number | null;
  totals: {
    tracked: number;
    applied: number;
    active: number;
    interviewing: number;
    offers: number;
    rejected: number;
    awaitingResponse: number;
    viaAgency: number;
  };
  rates: {
    responseRate: number;
    interviewRate: number;
    offerRate: number;
    rejectionRate: number;
    avgDaysToFirstResponse: number | null;
    medianDaysToFirstResponse: number | null;
  };
  funnel: FunnelStage[];
  pipeline: Pipeline;
  statusCounts: Array<{ sStatus: JobStatus; count: number }>;
  weeklyApplications: Array<{ week: string; applications: number; responses: number }>;
  bySource: Array<{ sSource: string; applications: number; interviews: number; offers: number; interviewRate: number }>;
  byContractType: Array<{ sContractType: string; applications: number; interviews: number }>;
  byLocation: Array<{ sLocation: string; applications: number; interviews: number }>;
  topTech: Array<{ tech: string; jobs: number; interviews: number }>;
  topCompanies: Array<{ sCompany: string; applications: number; deepestStage: string }>;
  staleApplications: Array<{ uuid: string; sCompany: string; sJobTitle: string; sStatus: JobStatus; daysSinceUpdate: number }>;
  agent: {
    runs: number;
    succeeded: number;
    failed: number;
    repairRate: number;
    avgDurationMs: number | null;
    totalTokens: number;
  };
}

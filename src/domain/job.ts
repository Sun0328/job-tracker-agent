/**
 * Field names follow the database convention: s = string, b = boolean,
 * i = integer, dt = ISO datetime. The API speaks these names too, so there is
 * one vocabulary from D1 through the agent to the UI.
 */

export const JOB_STATUSES = [
  "Saved",
  "Applied",
  "HR screen",
  "Tech interview",
  "Behavior interview",
  "Final",
  "Offer",
  "Reject",
] as const;

export const CONTRACT_TYPES = [
  "Permanent",
  "Fixed-term",
  "Part-time",
  "Contract",
  "Casual",
  "Internship",
] as const;

export const JOB_SOURCES = ["SEEK", "LinkedIn", "Company Website", "Trade Me Jobs", "Other"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type ContractType = (typeof CONTRACT_TYPES)[number];
export type JobSource = (typeof JOB_SOURCES)[number];

/** Funnel depth. Reject is an outcome, not a stage, so it scores 0. */
export const STATUS_RANK: Record<JobStatus, number> = {
  Saved: 0,
  Applied: 1,
  "HR screen": 2,
  "Tech interview": 3,
  "Behavior interview": 4,
  Final: 5,
  Offer: 6,
  Reject: 0,
};

export const CLOSED_STATUSES: JobStatus[] = ["Reject", "Offer"];

export interface CompanyMeta {
  industry: string | null;
  business: string | null;
  website_url: string | null;
}

/** What sub-agent 1 produces from a job advert. */
export interface ExtractedJob {
  sCompany: string;
  bAgency: boolean;
  sCompanyMeta: CompanyMeta | null;
  sJobTitle: string;
  sJobRequirement: string;
  /** Never null from extraction: Permanent is the default when the advert is silent. */
  sContractType: ContractType;
  sLocation: string | null;
  sJobSummary: string;
  sSource: JobSource;
  sSourceUrl: string | null;
  sTechStack: string[];
}

/** A tracked application: the extracted record plus everything the tracker adds to it. */
export interface Job extends ExtractedJob {
  uuid: string;
  sCoverLetterPath: string | null;
  sStatus: JobStatus;
  /** The furthest stage this application ever reached. */
  sDeepestStatus: JobStatus;
  /** When it was first sent, and when someone first replied. */
  dtApplied: string | null;
  dtFirstResponse: string | null;
  bDelete: boolean;
  /** True when the run that produced this row failed or came back incomplete. */
  bError: boolean;
  dtDateTime: string;
  dtUpdateDateTime: string;
  sNote: string;
  sRunID: string | null;
}

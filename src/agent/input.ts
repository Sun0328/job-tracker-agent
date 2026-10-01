/**
 * The only input to the flow is the advert text, pasted as-is. Job-board chrome
 * ("Apply now", "Save job", cookie notices) is left in place deliberately — the
 * agent reads past it, and a hardcoded strip list would eventually delete real
 * advert content. All that happens here is whitespace tidying.
 */
export function tidyJobPost(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface JobPostVerdict {
  bIsJobPost: boolean;
  sReason: string;
  /** What the text actually is, when it is not an advert. */
  sLooksLike: string | null;
}

/** Thrown when the agent says the input is not a job advert. Callers stop and ask for one. */
export class NotAJobPostError extends Error {
  readonly reason: string;
  readonly looksLike: string | null;

  constructor(verdict: JobPostVerdict) {
    super("That does not look like a job advertisement. Paste the full job post text and I will extract it.");
    this.name = "NotAJobPostError";
    this.reason = verdict.sReason;
    this.looksLike = verdict.sLooksLike;
  }
}

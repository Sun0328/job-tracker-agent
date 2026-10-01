import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Candidate {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  salutation: string;
  /** Stated in the Additional Information section of every letter. */
  visaStatus: string;
  visaExpiry: string;
  noticePeriod: string;
  residenceNote: string;
  signOff: string;
}

const DEFAULTS: Candidate = {
  fullName: "",
  email: "",
  phone: "",
  location: "Auckland",
  salutation: "Dear Recruitment Team",
  visaStatus: "open-work visa",
  visaExpiry: "March 2028",
  noticePeriod: "4-week",
  residenceNote: "",
  signOff: "Kind regards",
};

/** data/candidate.json — the facts every cover letter has to state. */
export async function loadCandidate(): Promise<Candidate> {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "candidate.json"), "utf8");
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Candidate>) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** data/highlights.md — standing facts the letter may draw on, beyond the resume. */
export async function loadHighlights(): Promise<string> {
  try {
    return (await readFile(path.join(process.cwd(), "data", "highlights.md"), "utf8")).trim();
  } catch {
    return "";
  }
}

/** The two right-aligned lines under the name. */
export function contactLines(candidate: Candidate): string[] {
  const contact = [candidate.phone, candidate.email].filter(Boolean).join("  |  ");
  return [candidate.location, contact].filter(Boolean);
}

/**
 * Written from configuration rather than by the model: visa dates and notice
 * periods are facts, and a model has no business rephrasing them.
 */
export function additionalInformation(candidate: Candidate): string {
  return [
    "I currently hold a valid " + candidate.visaStatus + " valid until " + candidate.visaExpiry + ".",
    candidate.residenceNote,
    "I am available to start work after serving my " + candidate.noticePeriod + " notice period.",
  ].filter(Boolean).join(" ");
}

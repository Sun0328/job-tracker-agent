import { readFile } from "node:fs/promises";
import path from "node:path";
import { getFileStorage } from "@/infra/storage";

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

/** Where the profile lives in storage. The deployed demo keeps its fictional candidate here. */
export const PROFILE_KEYS = { candidate: "profile/candidate.json", highlights: "profile/highlights.md" } as const;

async function readStored(key: string): Promise<string | null> {
  try {
    const object = await getFileStorage().get(key);
    return object ? new TextDecoder().decode(object.body) : null;
  } catch {
    return null;
  }
}

async function readLocal(fileName: string): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), "data", fileName), "utf8");
  } catch {
    return null;
  }
}

/**
 * The facts every cover letter has to state. Storage first (profile/candidate.json),
 * then data/candidate.json on this machine. A Worker has no project folder, so the
 * deployed demo reads its fictional candidate from its own bucket.
 */
export async function loadCandidate(): Promise<Candidate> {
  const raw = (await readStored(PROFILE_KEYS.candidate)) ?? (await readLocal("candidate.json"));
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Candidate>) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Standing facts the letter may draw on, beyond the resume. Same order: storage, then data/highlights.md. */
export async function loadHighlights(): Promise<string> {
  return ((await readStored(PROFILE_KEYS.highlights)) ?? (await readLocal("highlights.md")) ?? "").trim();
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

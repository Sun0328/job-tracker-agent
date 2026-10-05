import { listFiles, type JobFile } from "@/data/file-repository";
import { getFileStorage, type StoredObject } from "@/infra/storage";
import { extractPdfText } from "@/infra/pdf/extract-text";

/**
 * Resumes are read straight out of the bucket, so dropping a new PDF in through
 * the Cloudflare dashboard is enough — no upload command required. Both the
 * "resume/" folder and anything registered as kind "cv" count.
 */
export const RESUME_PREFIXES = (process.env.RESUME_PREFIX || "resume/,cv/")
  .split(",")
  .map((prefix) => prefix.trim())
  .filter(Boolean);

/** Thrown by any agent that needs a CV and finds none. */
export class NoResumeError extends Error {
  constructor() {
    super("No resume found. Put PDFs in the bucket under resume/, or add one with cv:add.");
    this.name = "NoResumeError";
  }
}

export interface ResumeSource {
  key: string;
  name: string;
  size: number;
  /** Description from the file's database row, when it has one. */
  note: string;
}

export interface Resume extends ResumeSource {
  text: string;
  chars: number;
  pages: number;
}

function isDocument(object: StoredObject): boolean {
  if (!object.size) return false;
  return /\.(pdf|md|txt)$/i.test(object.key);
}

/** Every resume-looking object in the bucket, with any note the database holds. */
export async function listResumes(): Promise<ResumeSource[]> {
  const storage = getFileStorage();
  const seen = new Map<string, ResumeSource>();

  for (const prefix of RESUME_PREFIXES) {
    for (const object of await storage.list(prefix, 100)) {
      if (!isDocument(object)) continue;
      seen.set(object.key, {
        key: object.key,
        name: object.key.split("/").pop() ?? object.key,
        size: object.size,
        note: "",
      });
    }
  }

  // Notes live on the JobFile row when the file was added through cv:add.
  let rows: JobFile[] = [];
  try {
    rows = await listFiles({ sKind: "cv", limit: 100 });
  } catch {
    rows = [];
  }
  for (const row of rows) {
    const existing = seen.get(row.sStoragePath);
    if (existing) existing.note = row.sNote;
    else if (row.iSizeBytes) {
      seen.set(row.sStoragePath, {
        key: row.sStoragePath,
        name: row.sFileName,
        size: row.iSizeBytes,
        note: row.sNote,
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Text already pulled out of a PDF CV, kept beside it in storage as
 * resume-text/<key>.json. Reading a PDF is the most CPU-hungry thing the agent
 * does, and the Workers free plan allows 10 ms of CPU per request, so the demo
 * ships this file and never parses its CV at runtime. A cache whose size does
 * not match the PDF is ignored, so replacing a CV cannot serve stale text.
 */
export const RESUME_TEXT_PREFIX = "resume-text/";

export interface ResumeTextCache {
  /** Byte size of the PDF the text came from. */
  size: number;
  text: string;
  pages: number;
}

export function resumeTextKey(resumeKey: string): string {
  return RESUME_TEXT_PREFIX + resumeKey + ".json";
}

export async function writeResumeTextCache(resumeKey: string, cache: ResumeTextCache): Promise<void> {
  await getFileStorage().put(resumeTextKey(resumeKey), new TextEncoder().encode(JSON.stringify(cache)), "application/json");
}

async function readResumeTextCache(resumeKey: string, size: number): Promise<ResumeTextCache | null> {
  try {
    const object = await getFileStorage().get(resumeTextKey(resumeKey));
    if (!object) return null;
    const cache = JSON.parse(new TextDecoder().decode(object.body)) as ResumeTextCache;
    return cache.size === size && typeof cache.text === "string" && cache.text.trim() ? cache : null;
  } catch {
    return null;
  }
}

/** Load every resume and pull its text out. A file that cannot be read is skipped, not fatal. */
export async function loadResumes(): Promise<{ resumes: Resume[]; skipped: Array<{ name: string; reason: string }> }> {
  const storage = getFileStorage();
  const sources = await listResumes();
  const resumes: Resume[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const source of sources) {
    try {
      if (/\.pdf$/i.test(source.key)) {
        const cached = await readResumeTextCache(source.key, source.size);
        if (cached) {
          resumes.push({ ...source, text: cached.text, chars: cached.text.length, pages: cached.pages });
          continue;
        }
      }

      const object = await storage.get(source.key);
      if (!object) throw new Error("object missing from storage");

      if (/\.pdf$/i.test(source.key)) {
        const extracted = await extractPdfText(object.body, source.name);
        resumes.push({ ...source, text: extracted.text, chars: extracted.chars, pages: extracted.pages });
      } else {
        const text = new TextDecoder().decode(object.body).trim();
        if (!text) throw new Error("file is empty");
        resumes.push({ ...source, text, chars: text.length, pages: 1 });
      }
    } catch (error) {
      skipped.push({ name: source.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { resumes, skipped };
}

/** A short, cheap summary of a CV for the model to compare against a job. */
export function resumeDigest(resume: Resume, limit = 1800): string {
  return [
    "File: " + resume.name + (resume.note ? " (" + resume.note + ")" : ""),
    resume.text.slice(0, limit),
  ].join("\n");
}

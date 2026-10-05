import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, freshDb } from "../helpers";
import { PROFILE_KEYS, loadCandidate, loadHighlights } from "@/data/candidate-profile";
import { loadResumes, resumeTextKey, writeResumeTextCache } from "@/data/resume-repository";
import { createLocalFileStorage } from "@/infra/storage/local-files";
import { getFileStorage, setFileStorage } from "@/infra/storage";
import type { SqlExecutor } from "@/infra/db";

let db: SqlExecutor;
let root: string;

beforeEach(async () => {
  db = await freshDb();
  root = await mkdtemp(path.join(tmpdir(), "jobpilot-profile-"));
  setFileStorage(createLocalFileStorage(root));
});

afterEach(async () => {
  setFileStorage(null);
  await closeDb(db);
  await rm(root, { recursive: true, force: true });
});

const text = (value: string) => new TextEncoder().encode(value);

describe("candidate profile", () => {
  it("prefers the profile in storage, which is how the deployed demo gets its fictional candidate", async () => {
    await getFileStorage().put(PROFILE_KEYS.candidate, text(JSON.stringify({ fullName: "Alex Rivera", noticePeriod: "2-week" })), "application/json");
    await getFileStorage().put(PROFILE_KEYS.highlights, text("  - Built a claims assistant.  \n"), "text/markdown");

    const candidate = await loadCandidate();
    expect(candidate.fullName).toBe("Alex Rivera");
    expect(candidate.noticePeriod).toBe("2-week");
    expect(candidate.signOff).toBe("Kind regards");
    expect(await loadHighlights()).toBe("- Built a claims assistant.");
  });
});

describe("resume text cache", () => {
  // Not a real PDF: if the loader tried to parse it, it would be skipped as unreadable.
  const fakePdf = text("%PDF-not-really");

  it("uses the pre-extracted text and never parses the PDF", async () => {
    await getFileStorage().put("resume/Alex.pdf", fakePdf, "application/pdf");
    await writeResumeTextCache("resume/Alex.pdf", { size: fakePdf.byteLength, text: "Alex Rivera, AI engineer", pages: 1 });

    const { resumes, skipped } = await loadResumes();
    expect(skipped).toEqual([]);
    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toMatchObject({ name: "Alex.pdf", text: "Alex Rivera, AI engineer", pages: 1 });
    expect(resumeTextKey("resume/Alex.pdf")).toBe("resume-text/resume/Alex.pdf.json");
  });

  it("ignores a cache made for a different version of the file", async () => {
    await getFileStorage().put("resume/Alex.pdf", fakePdf, "application/pdf");
    await writeResumeTextCache("resume/Alex.pdf", { size: fakePdf.byteLength + 1, text: "stale text", pages: 1 });

    const { resumes, skipped } = await loadResumes();
    expect(resumes).toEqual([]);
    expect(skipped.map((item) => item.name)).toEqual(["Alex.pdf"]);
  });
});

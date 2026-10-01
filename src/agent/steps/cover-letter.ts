import { chat, deepSeekConfigured } from "@/infra/llm/deepseek";
import {
  CHOOSE_RESUME_SYSTEM_PROMPT,
  ONE_PAGE_WORDS,
  buildChooseResumePrompt,
  buildCoverLetterPrompt,
  buildCoverLetterSystemPrompt,
  buildShortenPrompt,
} from "@/agent/prompts/cover-letter";
import { buildPdf, callTool, pdfText, storagePut } from "@/agent/tools";
import type { LetterDocument } from "@/infra/pdf/render-letter";
import { modelDetail } from "@/agent/core/model-detail";
import type { RunTrace } from "@/agent/core/trace";
import { additionalInformation, contactLines, loadCandidate, loadHighlights } from "@/data/candidate-profile";
import { NoResumeError, loadResumes, resumeDigest, type Resume } from "@/data/resume-repository";
import { coverLetterKey } from "@/infra/storage";
import type { ExtractedJob } from "@/domain";

export interface CoverLetterOptions {
  job: ExtractedJob;
  trace: RunTrace;
  /** Link the PDF to a tracked application. */
  sJobUUID?: string | null;
  /** Skip the upload and return the bytes only. */
  save?: boolean;
  attempt?: number;
  signal?: AbortSignal;
}

export interface CoverLetterResult {
  letter: LetterDocument;
  /** Plain text of the whole letter, for the terminal and for review. */
  text: string;
  words: number;
  pages: number;
  /** R2 object key, the value that goes into Job.sCoverLetterPath. */
  sCoverLetterPath: string | null;
  resume: { sFileName: string; sReason: string } | null;
  bytes: Uint8Array;
  warnings: string[];
}

export { NoResumeError };

interface WrittenSections {
  aIntroduction: string[];
  sWhyGoodFit: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function letterToText(letter: LetterDocument): string {
  const lines: string[] = [letter.salutation + ",", ""];
  for (const section of letter.sections) {
    lines.push(section.heading);
    for (const paragraph of section.paragraphs) lines.push(paragraph, "");
  }
  lines.push(letter.signOff + ",", letter.name);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseSections(content: string): WrittenSections {
  const parsed = JSON.parse(content) as Partial<WrittenSections> & { sIntroduction?: string };
  const introduction = Array.isArray(parsed.aIntroduction)
    ? parsed.aIntroduction.map((item) => String(item).trim()).filter(Boolean)
    : String(parsed.sIntroduction ?? "").split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);

  if (!introduction.length || !parsed.sWhyGoodFit) throw new Error("the model did not return both sections");
  return { aIntroduction: introduction, sWhyGoodFit: String(parsed.sWhyGoodFit).trim() };
}

/**
 * Sub-agent 2. Input: the structured job, the candidate's resumes and standing
 * highlights. Output: a one-page PDF in Cloudflare storage, laid out to the
 * candidate's own template.
 */
export async function runCoverLetterAgent(options: CoverLetterOptions): Promise<CoverLetterResult> {
  const { trace, job } = options;
  const agent = { sAgent: "cover-letter" as const, iAttempt: options.attempt ?? 1 };
  const warnings: string[] = [];
  const [candidate, highlights] = await Promise.all([loadCandidate(), loadHighlights()]);

  // 1. Every CV in the bucket, as text.
  const loaded = await trace.step(
    "load-resumes",
    "Read the resumes in storage",
    async (step) => {
      const result = await loadResumes();
      for (const resume of result.resumes) {
        step.tool({
          tool: pdfText.name,
          durationMs: 0,
          ok: true,
          summary: resume.name + ": " + resume.pages + " page(s), " + resume.chars + " chars",
          detail: { key: resume.key, note: resume.note },
        });
      }
      step.detail({
        found: result.resumes.length,
        files: result.resumes.map((resume) => resume.name),
        skipped: result.skipped,
      });
      for (const item of result.skipped) warnings.push("Skipped " + item.name + ": " + item.reason);
      if (!result.resumes.length) throw new NoResumeError();
      return result.resumes;
    },
    agent,
  );

  // 2. Which one fits this advert.
  let chosen: Resume = loaded[0];
  let choiceReason = "only one resume in storage";

  if (loaded.length === 1) {
    trace.skip("choose-resume", "Only one resume, nothing to choose", { file: chosen.name }, "cover-letter");
  } else if (!deepSeekConfigured()) {
    trace.skip("choose-resume", "No API key, using the first resume", { file: chosen.name }, "cover-letter");
    choiceReason = "no API key to choose with";
  } else {
    const picked = await trace.step(
      "choose-resume",
      "Pick the resume that fits this role",
      async (step) => {
        let choice: { sFileName?: string; sReason?: string; aRejected?: Array<{ sFileName: string; sReason: string }> } = {};
        let failure: string | null = null;
        let answered: Record<string, unknown> = {};

        try {
          const result = await chat(
            [
              { role: "system", content: CHOOSE_RESUME_SYSTEM_PROMPT },
              { role: "user", content: buildChooseResumePrompt(job, loaded.map((resume) => resumeDigest(resume))) },
            ],
            // Uncapped: comparing several resumes is a long reasoning job.
            { json: true, temperature: 0, signal: options.signal },
          );
          step.addUsage(result.usage);
          answered = { ...modelDetail(result), raw: result.content.slice(0, 4000) };
          choice = JSON.parse(result.content);
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }

        const match = loaded.find((resume) => resume.name === choice.sFileName)
          ?? loaded.find((resume) => resume.name.toLowerCase() === (choice.sFileName ?? "").toLowerCase());

        step.detail({
          ...answered,
          candidates: loaded.map((resume) => resume.name),
          chose: match?.name ?? loaded[0].name,
          reason: choice.sReason ?? null,
          rejected: choice.aRejected ?? [],
          error: failure,
        });

        // A silent fallback would hide a wrong resume behind a confident letter.
        if (failure) {
          step.setStatus("failed");
          warnings.push("Resume choice failed (" + failure + "); used " + loaded[0].name + ".");
          return { resume: loaded[0], reason: "fell back to the first resume: the choice call failed (" + failure + ")" };
        }
        if (!match) {
          warnings.push("The model named a resume that is not in storage; used " + loaded[0].name + ".");
          return {
            resume: loaded[0],
            reason: "fell back to the first resume: the model named " + (choice.sFileName ?? "nothing"),
          };
        }

        const rejected = (choice.aRejected ?? [])
          .map((item) => item.sFileName + ": " + item.sReason)
          .join("; ");
        return {
          resume: match,
          reason: (choice.sReason ?? "no reason given") + (rejected ? " | not chosen — " + rejected : ""),
        };
      },
      agent,
    );
    chosen = picked.resume;
    choiceReason = picked.reason;
  }

  // 3. The two written sections. Additional Information is not the model's to write.
  let written = await trace.step(
    "write-letter",
    "Write the introduction and the fit section",
    async (step) => {
      if (!deepSeekConfigured()) {
        const draft: WrittenSections = {
          aIntroduction: [
            "I am a software engineer based in " + candidate.location + ".",
            "I am writing to apply for the " + job.sJobTitle + " role at " + job.sCompany + ".",
          ],
          sWhyGoodFit: "My background covers " + (job.sTechStack.slice(0, 3).join(", ") || "software delivery")
            + ", which is the core of this role.",
        };
        step.detail({ simulated: true });
        return draft;
      }

      const result = await chat(
        [
          { role: "system", content: buildCoverLetterSystemPrompt() },
          { role: "user", content: buildCoverLetterPrompt(job, chosen.text, highlights, candidate) },
        ],
        // No token cap: the model reasons before it writes, and a cap truncates the letter.
        { json: true, temperature: 0.4, onDelta: step.delta, signal: options.signal },
      );
      step.addUsage(result.usage);

      const sections = parseSections(result.content);
      step.detail({
        ...modelDetail(result),
        resume: chosen.name,
        introParagraphs: sections.aIntroduction.length,
        words: countWords(sections.aIntroduction.join(" ") + " " + sections.sWhyGoodFit),
        wordLimit: ONE_PAGE_WORDS,
        raw: result.content.slice(0, 4000),
      });
      return sections;
    },
    agent,
  );

  const assemble = (sections: WrittenSections): LetterDocument => ({
    name: candidate.fullName,
    contactLines: contactLines(candidate),
    salutation: candidate.salutation,
    sections: [
      { heading: "Introduction", paragraphs: sections.aIntroduction },
      { heading: "Why I Am a Good Fit", paragraphs: [sections.sWhyGoodFit] },
      { heading: "Additional Information", paragraphs: [additionalInformation(candidate)] },
    ],
    signOff: candidate.signOff,
  });

  let letter = assemble(written);

  // 4. Render, and if it spills past one page, cut it down once.
  const built = await trace.step(
    "build-pdf",
    "Render the letter as a one-page PDF",
    async (step) => {
      let output = await callTool(step, buildPdf, { letter, title: job.sJobTitle + ", " + job.sCompany });

      if (output.pages > 1 && deepSeekConfigured()) {
        const shorter = await chat(
          [
            { role: "system", content: buildCoverLetterSystemPrompt(230) },
            { role: "user", content: buildShortenPrompt(written.aIntroduction, written.sWhyGoodFit, 230) },
          ],
          { json: true, temperature: 0.2, signal: options.signal },
        );
        step.addUsage(shorter.usage);

        try {
          written = parseSections(shorter.content);
          letter = assemble(written);
          output = await callTool(step, buildPdf, { letter, title: job.sJobTitle + ", " + job.sCompany });
          warnings.push("The letter needed a second pass to fit on one page.");
        } catch {
          warnings.push("The shortening pass failed; the long version was kept.");
        }
      }

      step.detail({ pages: output.pages, sizeBytes: output.sizeBytes, words: countWords(letterToText(letter)) });
      if (output.pages > 1) {
        step.setStatus("failed");
        warnings.push("The letter is still " + output.pages + " pages. Shorten it by hand before sending.");
      }
      return output;
    },
    agent,
  );

  // 5. Into Cloudflare storage, one folder per company.
  let sCoverLetterPath: string | null = null;
  if (options.save === false) {
    trace.skip("save-pdf", "Not saved", { reason: "save=false" }, "cover-letter");
  } else {
    sCoverLetterPath = await trace.step(
      "save-pdf",
      "Save the PDF to storage",
      async (step) => {
        const key = coverLetterKey(job.sCompany, job.sJobTitle);
        const stored = await callTool(step, storagePut, {
          body: built.bytes,
          sStoragePath: key,
          sFileName: key.split("/").pop() ?? "cover-letter.pdf",
          sContentType: "application/pdf",
          sKind: "cover-letter",
          sJobUUID: options.sJobUUID ?? null,
          sNote: "Generated from " + chosen.name,
        });
        step.detail({ path: stored.sStoragePath, fileId: stored.uuid, bytes: stored.iSizeBytes });
        return stored.sStoragePath;
      },
      agent,
    );
  }

  const text = letterToText(letter);
  return {
    letter,
    text,
    words: countWords(text),
    pages: built.pages,
    sCoverLetterPath,
    resume: { sFileName: chosen.name, sReason: choiceReason },
    bytes: built.bytes,
    warnings,
  };
}

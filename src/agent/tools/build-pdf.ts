import type { Tool } from "@/agent/core/tool";
import { renderLetter, type RenderLetterInput, type RenderedPdf } from "@/infra/pdf/render-letter";

export type { LetterDocument, LetterSection } from "@/infra/pdf/render-letter";
export type BuildPdfInput = RenderLetterInput;
export type BuildPdfOutput = RenderedPdf;

export const buildPdf: Tool<BuildPdfInput, BuildPdfOutput> = {
  name: "build_pdf",
  description: "Render a cover letter as a one-page A4 PDF.",

  async run(input) {
    return renderLetter(input);
  },

  summarise(_input, output) {
    return output.pages + " page(s), " + Math.round(output.sizeBytes / 1024) + "KB";
  },
};

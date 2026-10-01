import type { Tool } from "@/agent/core/tool";
import { extractPdfText, type PdfText } from "@/infra/pdf/extract-text";

export interface PdfTextInput {
  bytes: Uint8Array;
  /** Shown in the trace so a failure names the file. */
  label?: string;
}

export type PdfTextOutput = PdfText;

export const pdfText: Tool<PdfTextInput, PdfTextOutput> = {
  name: "pdf_text",
  description: "Extract the text of a PDF document.",

  async run(input) {
    return extractPdfText(input.bytes, input.label);
  },

  summarise(input, output) {
    return (input.label ?? "pdf") + ": " + output.pages + " page(s), " + output.chars + " chars";
  },
};

export interface PdfText {
  text: string;
  pages: number;
  chars: number;
}

/**
 * unpdf bundles a serverless build of pdf.js: no native modules, no canvas, so a
 * CV uploaded as a PDF can be read anywhere this runs.
 */
export async function extractPdfText(bytes: Uint8Array, label = "PDF"): Promise<PdfText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js takes ownership of the buffer it is handed and detaches it, so give
  // it a copy — the caller still needs the original bytes to upload.
  const document = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(document, { mergePages: true });

  const merged = (Array.isArray(text) ? text.join("\n") : text)
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!merged) {
    throw new Error(label + " has no extractable text — it is probably a scan. Export it from Word or Docs instead.");
  }
  return { text: merged, pages: totalPages, chars: merged.length };
}

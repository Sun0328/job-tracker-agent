import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface LetterSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LetterDocument {
  name: string;
  /** Right-aligned lines under the name: location, then phone | email. */
  contactLines: string[];
  salutation: string;
  sections: LetterSection[];
  signOff: string;
}

export interface RenderLetterInput {
  /** Laid out like the template: right-aligned header, blue section headings. */
  letter?: LetterDocument;
  /** Plain fallback: one block of text, blank lines between paragraphs. */
  body?: string;
  heading?: string;
  subheading?: string;
  title?: string;
}

export interface RenderedPdf {
  bytes: Uint8Array;
  pages: number;
  sizeBytes: number;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 64;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 15;
const PARAGRAPH_GAP = 9;
/** Equal space above and below every section heading. */
const HEADING_GAP = 13;

const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.42, 0.44, 0.48);
const ACCENT = rgb(0.29, 0.47, 0.92);

/** pdf-lib's standard fonts are WinAnsi only; curly quotes and dashes would throw. */
function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x00-\xFF]/g, "");
}

/** Greedy wrap against real glyph widths so lines never overflow the margin. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? current + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

class Layout {
  readonly document: PDFDocument;
  private page: PDFPage;
  private cursor: number;

  constructor(document: PDFDocument) {
    this.document = document;
    this.page = document.addPage([A4.width, A4.height]);
    this.cursor = A4.height - MARGIN;
  }

  get maxWidth() {
    return A4.width - MARGIN * 2;
  }

  private ensure(height: number) {
    if (this.cursor - height < MARGIN) {
      this.page = this.document.addPage([A4.width, A4.height]);
      this.cursor = A4.height - MARGIN;
    }
  }

  space(points: number) {
    this.cursor -= points;
  }

  text(
    value: string,
    options: { font: PDFFont; size: number; color?: typeof INK; align?: "left" | "right"; indent?: number; lineHeight?: number },
  ) {
    const lineHeight = options.lineHeight ?? LINE_HEIGHT;
    const indent = options.indent ?? 0;
    for (const line of wrap(toWinAnsi(value), options.font, options.size, this.maxWidth - indent)) {
      this.ensure(lineHeight);
      if (line) {
        const width = options.font.widthOfTextAtSize(line, options.size);
        const x = options.align === "right" ? A4.width - MARGIN - width : MARGIN + indent;
        this.page.drawText(line, { x, y: this.cursor, size: options.size, font: options.font, color: options.color ?? INK });
      }
      this.cursor -= lineHeight;
    }
  }

  bullet(value: string, font: PDFFont, size: number) {
    this.ensure(LINE_HEIGHT);
    this.page.drawText("-", { x: MARGIN + 6, y: this.cursor, size, font, color: INK });
    this.text(value, { font, size, indent: 20 });
  }
}

/** Render a letter (or a plain block of text) as an A4 PDF, to the candidate's template. */
export async function renderLetter(input: RenderLetterInput): Promise<RenderedPdf> {
  const document = await PDFDocument.create();
  const body = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  const serif = await document.embedFont(StandardFonts.TimesRomanBold);

  document.setTitle(input.title ?? "Cover letter");
  document.setProducer("JobPilot");
  document.setCreationDate(new Date());

  const layout = new Layout(document);

  if (input.letter) {
    const letter = input.letter;

    // Header block, right aligned, like the template.
    layout.text(letter.name, { font: serif, size: 26, align: "right", lineHeight: 30 });
    layout.space(4);
    if (letter.contactLines[0]) {
      layout.text(letter.contactLines[0], { font: italic, size: 9.5, color: MUTED, align: "right", lineHeight: 14 });
    }
    for (const line of letter.contactLines.slice(1)) {
      layout.text(line, { font: body, size: 9.5, color: MUTED, align: "right", lineHeight: 14 });
    }

    layout.space(26);
    layout.text(letter.salutation + ",", { font: body, size: BODY_SIZE });

    for (const section of letter.sections) {
      // Same gap above the heading as below it. Paragraphs inside a section are
      // separated by PARAGRAPH_GAP, and the last one adds nothing, so the next
      // heading sits exactly HEADING_GAP away.
      layout.space(HEADING_GAP);
      layout.text(section.heading, { font: bold, size: 13, color: ACCENT, lineHeight: 15 });
      layout.space(HEADING_GAP);

      const paragraphs = section.paragraphs.filter((paragraph) => paragraph.trim());
      paragraphs.forEach((paragraph, index) => {
        layout.text(paragraph.trim(), { font: body, size: BODY_SIZE });
        if (index < paragraphs.length - 1) layout.space(PARAGRAPH_GAP);
      });
      for (const item of section.bullets ?? []) {
        if (item.trim()) layout.bullet(item.trim(), body, BODY_SIZE);
      }
    }

    layout.space(HEADING_GAP + 8);
    layout.text(letter.signOff + ",", { font: body, size: BODY_SIZE });
    layout.space(6);
    layout.text(letter.name, { font: bold, size: BODY_SIZE });
  } else {
    if (input.heading) layout.text(input.heading, { font: bold, size: 15, lineHeight: 20 });
    if (input.subheading) {
      layout.text(input.subheading, { font: body, size: 9.5, color: MUTED, lineHeight: 14 });
      layout.space(10);
    }
    for (const paragraph of (input.body ?? "").split(/\n\s*\n/)) {
      if (!paragraph.trim()) continue;
      layout.text(paragraph.trim(), { font: body, size: BODY_SIZE });
      layout.space(PARAGRAPH_GAP);
    }
  }

  const bytes = await document.save();
  return { bytes, pages: document.getPageCount(), sizeBytes: bytes.byteLength };
}

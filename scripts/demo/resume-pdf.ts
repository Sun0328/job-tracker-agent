import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** demo/resume.json: one fictional person, two CV variants that share the work history. */
export interface DemoResume {
  name: string;
  contact: string[];
  footer: string;
  variants: Array<{ fileName: string; note: string; headline: string; summary: string; skills: string[]; emphasis: "ai" | "web" }>;
  experience: Array<{ role: string; company: string; place: string; dates: string; ai: string[]; web: string[] }>;
  projects: string[];
  education: string;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.4, 0.42, 0.46);
const ACCENT = rgb(0.16, 0.42, 0.76);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** A clean one-page CV for one variant. Standard fonts only, so the text extracts exactly. */
export async function renderResumePdf(resume: DemoResume, variantIndex: number): Promise<Uint8Array> {
  const variant = resume.variants[variantIndex];
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const italic = await document.embedFont(StandardFonts.HelveticaOblique);
  document.setTitle(resume.name + " CV");
  document.setAuthor(resume.name + " (fictional)");
  document.setProducer("JobPilot demo");

  const page: PDFPage = document.addPage([A4.width, A4.height]);
  const width = A4.width - MARGIN * 2;
  let y = A4.height - MARGIN;

  const line = (text: string, font: PDFFont, size: number, color = INK, indent = 0, gap = 1.45) => {
    for (const piece of wrap(text, font, size, width - indent)) {
      page.drawText(piece, { x: MARGIN + indent, y, size, font, color });
      y -= size * gap;
    }
  };
  const heading = (text: string) => {
    y -= 8;
    page.drawText(text.toUpperCase(), { x: MARGIN, y, size: 9.5, font: bold, color: ACCENT });
    y -= 5;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.6, color: ACCENT });
    y -= 13;
  };
  const bullet = (text: string) => {
    page.drawText("-", { x: MARGIN + 4, y, size: 9.5, font: regular, color: INK });
    line(text, regular, 9.5, INK, 14);
    y -= 1.5;
  };

  page.drawText(resume.name, { x: MARGIN, y: y - 6, size: 24, font: bold, color: INK });
  y -= 28;
  line(variant.headline, regular, 11.5, ACCENT);
  for (const contact of resume.contact) line(contact, regular, 9.5, MUTED);

  heading("Summary");
  line(variant.summary, regular, 9.8);

  heading("Experience");
  for (const job of resume.experience) {
    page.drawText(job.role + ", " + job.company, { x: MARGIN, y, size: 10.5, font: bold, color: INK });
    const dates = job.place + "  |  " + job.dates;
    page.drawText(dates, { x: A4.width - MARGIN - regular.widthOfTextAtSize(dates, 9), y, size: 9, font: regular, color: MUTED });
    y -= 15;
    for (const item of variant.emphasis === "ai" ? job.ai : job.web) bullet(item);
    y -= 4;
  }

  heading("Projects");
  for (const project of resume.projects) bullet(project);

  heading("Skills");
  for (const skill of variant.skills) bullet(skill);

  heading("Education");
  line(resume.education, regular, 9.8);

  page.drawText(resume.footer, { x: MARGIN, y: MARGIN - 20, size: 8, font: italic, color: MUTED });
  return document.save();
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { flag, loadEnv, option, optionRest } from "@/cli/args";
import { deleteFile, saveFile } from "@/data/file-repository";
import { listResumes } from "@/data/resume-repository";
import { getDb } from "@/infra/db";
import { selectedFileDriver } from "@/infra/storage";
import { extractPdfText } from "@/infra/pdf/extract-text";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function list() {
  const resumes = await listResumes();
  if (!resumes.length) {
    console.log("No resumes found.");
    console.log("Put PDFs in the bucket under resume/, or add one:");
    console.log("  node --import tsx scripts/cv-add.ts --file <path to cv.pdf> --note \"QA automation\"");
    return;
  }
  console.log("Resumes the agent can see (" + selectedFileDriver() + "):");
  console.log("");
  for (const resume of resumes) {
    console.log("  " + resume.name.padEnd(30) + String(Math.round(resume.size / 1024)).padStart(4) + "KB  "
      + resume.key + (resume.note ? "  — " + resume.note : ""));
  }
}

async function main() {
  loadEnv();
  const db = await getDb();

  try {
    if (flag("list")) return await list();

    const remove = option("delete");
    if (remove) {
      console.log(await deleteFile(remove, true) ? "Deleted " + remove : "No such file: " + remove);
      return;
    }

    const file = option("file");
    if (!file) {
      console.error("Usage:");
      console.error('  node --import tsx scripts/cv-add.ts --file "C:\\path\\to\\cv.pdf" --note "QA automation roles"');
      console.error("  node --import tsx scripts/cv-add.ts --list");
      console.error("  node --import tsx scripts/cv-add.ts --delete <uuid>");
      process.exitCode = 1;
      return;
    }

    const bytes = new Uint8Array(await readFile(file));
    const name = path.basename(file);
    const extension = path.extname(file).toLowerCase();

    // Read it now, so a scanned PDF fails here rather than mid-application.
    if (extension === ".pdf") {
      const extracted = await extractPdfText(bytes, name);
      console.log("read " + extracted.pages + " page(s), " + extracted.chars + " characters of text");
    }

    const record = await saveFile({
      body: bytes,
      sFileName: name,
      sContentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
      sKind: "cv",
      sNote: optionRest("note") ?? "",
    });

    console.log("stored " + record.sFileName + " at " + record.sStoragePath);
    console.log("  id " + record.uuid + ", " + Math.round(record.iSizeBytes / 1024) + "KB");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("cv:add failed: " + (error instanceof Error ? error.message : error));
  process.exitCode = 1;
});

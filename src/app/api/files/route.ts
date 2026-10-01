import { NextResponse } from "next/server";
import { listFiles, saveFile } from "@/data/file-repository";
import { FILE_KINDS, type FileKind } from "@/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sKind = url.searchParams.get("sKind");
  if (sKind && !FILE_KINDS.includes(sKind as FileKind)) {
    return NextResponse.json({ error: "sKind must be one of " + FILE_KINDS.join(", ") }, { status: 400 });
  }

  try {
    const files = await listFiles({
      sJobUUID: url.searchParams.get("sJobUUID") ?? undefined,
      sKind: (sKind as FileKind) ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    return NextResponse.json({ files, count: files.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to list files" }, { status: 500 });
  }
}

/** multipart/form-data: file, plus optional sKind, sJobUUID and sNote. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send multipart/form-data with a 'file' field" }, { status: 400 });
  }

  const uploaded = form.get("file");
  if (!(uploaded instanceof File)) return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  if (uploaded.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 15MB" }, { status: 413 });

  const sKind = String(form.get("sKind") ?? "attachment");
  if (!FILE_KINDS.includes(sKind as FileKind)) {
    return NextResponse.json({ error: "sKind must be one of " + FILE_KINDS.join(", ") }, { status: 400 });
  }

  try {
    const record = await saveFile({
      body: new Uint8Array(await uploaded.arrayBuffer()),
      sFileName: uploaded.name || "upload",
      sContentType: uploaded.type || undefined,
      sKind: sKind as FileKind,
      sJobUUID: (form.get("sJobUUID") as string) || null,
      sNote: (form.get("sNote") as string) || "",
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 500 });
  }
}

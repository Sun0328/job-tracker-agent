import { NextResponse } from "next/server";
import { deleteFile, fileDownloadUrl, getFileRecord, readFile } from "@/data/file-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ uuid: string }> };

/** ?download=1 streams the bytes, ?url=1 returns a short-lived R2 link, otherwise metadata. */
export async function GET(request: Request, context: Context) {
  const { uuid } = await context.params;
  const url = new URL(request.url);

  try {
    if (url.searchParams.get("url")) {
      const link = await fileDownloadUrl(uuid, Number(url.searchParams.get("expires") ?? 900));
      if (!link) return NextResponse.json({ error: "No signed URL for this storage driver" }, { status: 404 });
      return NextResponse.json({ url: link });
    }

    if (url.searchParams.get("download")) {
      const found = await readFile(uuid);
      if (!found) return NextResponse.json({ error: "File not found" }, { status: 404 });
      const disposition = url.searchParams.get("inline") ? "inline" : "attachment";
      return new NextResponse(Buffer.from(found.body), {
        headers: {
          "Content-Type": found.record.sContentType,
          "Content-Disposition": disposition + '; filename="' + found.record.sFileName.replace(/"/g, "") + '"',
          "Content-Length": String(found.body.byteLength),
        },
      });
    }

    const record = await getFileRecord(uuid);
    if (!record) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read file" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { uuid } = await context.params;
  const hard = new URL(request.url).searchParams.get("hard") === "1";
  try {
    const removed = await deleteFile(uuid, hard);
    if (!removed) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return NextResponse.json({ deleted: uuid, hard });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete file" }, { status: 500 });
  }
}

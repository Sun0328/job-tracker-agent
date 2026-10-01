import { NextResponse } from "next/server";
import { getJob } from "@/data/job-repository";
import { downloadUrlForPath, readByPath } from "@/data/file-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ uuid: string }> };

/**
 * The cover letter for one application.
 *
 * By default this redirects to a short-lived signed URL so the browser pulls the
 * file straight from Cloudflare storage and the bytes never come through here.
 * `?proxy=1` streams it through the server instead, which is the only option on
 * the local file driver. `?url=1` returns the link as JSON.
 */
export async function GET(request: Request, context: Context) {
  const { uuid } = await context.params;
  const search = new URL(request.url).searchParams;
  const wantsJson = search.get("url") === "1";
  const forceProxy = search.get("proxy") === "1";
  const expires = Math.min(Math.max(Number(search.get("expires") ?? 900), 60), 86_400);

  try {
    const job = await getJob(uuid);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!job.sCoverLetterPath) {
      return NextResponse.json({ error: "This application has no cover letter" }, { status: 404 });
    }

    const fileName = job.sCoverLetterPath.split("/").pop() ?? "cover-letter.pdf";

    if (!forceProxy) {
      const link = await downloadUrlForPath(job.sCoverLetterPath, expires, fileName);
      if (link) {
        return wantsJson
          ? NextResponse.json({ url: link, expiresInSeconds: expires, sStoragePath: job.sCoverLetterPath })
          : NextResponse.redirect(link, 302);
      }
      if (wantsJson) {
        return NextResponse.json({ error: "This storage driver has no direct links; use ?proxy=1" }, { status: 409 });
      }
    }

    const object = await readByPath(job.sCoverLetterPath);
    if (!object) {
      return NextResponse.json(
        { error: "The letter is recorded at " + job.sCoverLetterPath + " but is not in storage" },
        { status: 404 },
      );
    }

    return new NextResponse(Buffer.from(object.body), {
      headers: {
        "Content-Type": object.contentType || "application/pdf",
        "Content-Disposition": 'attachment; filename="' + fileName.replace(/"/g, "") + '"',
        "Content-Length": String(object.body.byteLength),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read the cover letter" },
      { status: 500 },
    );
  }
}

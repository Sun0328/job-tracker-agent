import { readByPath } from "@/data/file-repository";
import { failure, jsonError } from "@/server/http";
import { demoMode, demoResumeKey } from "@/services/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The demo's fictional CV, as a PDF. Only in demo mode: your real CVs are never served. */
export async function GET(request: Request) {
  if (!demoMode()) return jsonError("Not found", 404);
  try {
    const key = await demoResumeKey();
    const object = key ? await readByPath(key) : null;
    if (!key || !object) return jsonError("The demo CV is not in storage", 404);
    const fileName = key.split("/").pop() ?? "resume.pdf";
    const disposition = new URL(request.url).searchParams.get("download") ? "attachment" : "inline";
    return new Response(Buffer.from(object.body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition + '; filename="' + fileName.replace(/"/g, "") + '"',
        "Content-Length": String(object.body.byteLength),
      },
    });
  } catch (error) {
    return failure(error, "Unable to read the demo CV");
  }
}

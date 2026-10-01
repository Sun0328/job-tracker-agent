import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, freshDb, sampleJob } from "../helpers";
import { createJob } from "@/data/job-repository";
import { deleteFile, fileDownloadUrl, listFiles, readFile, saveFile } from "@/data/file-repository";
import { createLocalFileStorage } from "@/infra/storage/local-files";
import { buildKey, setFileStorage } from "@/infra/storage";
import type { SqlExecutor } from "@/infra/db";

let db: SqlExecutor;
let root: string;

beforeEach(async () => {
  db = await freshDb();
  root = await mkdtemp(path.join(tmpdir(), "jobpilot-files-"));
  setFileStorage(createLocalFileStorage(root));
});

afterEach(async () => {
  setFileStorage(null);
  await closeDb(db);
  await rm(root, { recursive: true, force: true });
});

const body = () => new TextEncoder().encode("cover letter body");

describe("file store", () => {
  it("stores the bytes and indexes the row", async () => {
    const record = await saveFile({ body: body(), sFileName: "letter.pdf", sContentType: "application/pdf", sKind: "cover-letter" });

    expect(record.uuid).toMatch(/[0-9a-f-]{36}/);
    expect(record.iSizeBytes).toBe(body().byteLength);
    expect(record.sChecksum).toHaveLength(32);

    const found = await readFile(record.uuid);
    expect(new TextDecoder().decode(found?.body)).toBe("cover letter body");
  });

  it("attaches a file to an application and lists it back", async () => {
    const job = await createJob(sampleJob);
    await saveFile({ body: body(), sFileName: "letter.pdf", sKind: "cover-letter", sJobUUID: job.uuid });
    await saveFile({ body: body(), sFileName: "cv.pdf", sKind: "cv" });

    expect(await listFiles({ sJobUUID: job.uuid })).toHaveLength(1);
    expect(await listFiles({ sKind: "cv" })).toHaveLength(1);
    expect(await listFiles()).toHaveLength(2);
  });

  it("soft deletes by default: the row hides, the object stays", async () => {
    const record = await saveFile({ body: body(), sFileName: "letter.pdf", sKind: "cover-letter" });
    expect(await deleteFile(record.uuid)).toBe(true);
    expect(await listFiles()).toHaveLength(0);
    expect(await deleteFile(record.uuid)).toBe(false);
  });

  it("hard deletes the object and the row together", async () => {
    const record = await saveFile({ body: body(), sFileName: "letter.pdf", sKind: "cover-letter" });
    expect(await deleteFile(record.uuid, true)).toBe(true);
    expect(await readFile(record.uuid)).toBeNull();
    expect(await listFiles()).toHaveLength(0);
  });

  it("has no signed URL on the local driver", async () => {
    const record = await saveFile({ body: body(), sFileName: "letter.pdf", sKind: "cover-letter" });
    expect(await fileDownloadUrl(record.uuid)).toBeNull();
  });

  it("builds keys that group by purpose and stay filesystem safe", () => {
    expect(buildKey("cv", "My CV (final).pdf")).toMatch(/^cv\/[\d\-TZ]+-My-CV-final.pdf$/);
    expect(buildKey("cover-letter", "letter.pdf", "job-123")).toMatch(/^cover-letter\/job-123\//);
  });

  it("refuses a key that escapes the storage root", async () => {
    const storage = createLocalFileStorage(root);
    await expect(storage.put("../escape.txt", body(), "text/plain")).rejects.toThrow("escape");
  });
});

import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/infra/db";
import type { Row } from "@/infra/db";
import { buildKey, getFileStorage, type FileKind } from "@/infra/storage";

const FILE_COLUMNS = [
  "uuid", "dtDateTime", "sJobUUID", "sKind", "sStoragePath", "sFileName",
  "sContentType", "iSizeBytes", "sChecksum", "sNote", "bDelete",
];
const SELECT_FILES = FILE_COLUMNS.join(", ");

export interface JobFile {
  uuid: string;
  dtDateTime: string;
  sJobUUID: string | null;
  sKind: FileKind;
  sStoragePath: string;
  sFileName: string;
  sContentType: string;
  iSizeBytes: number;
  sChecksum: string | null;
  sNote: string;
  bDelete: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function rowToFile(row: Row): JobFile {
  return {
    uuid: text(row.uuid),
    dtDateTime: text(row.dtDateTime),
    sJobUUID: text(row.sJobUUID) || null,
    sKind: text(row.sKind) as FileKind,
    sStoragePath: text(row.sStoragePath),
    sFileName: text(row.sFileName),
    sContentType: text(row.sContentType),
    iSizeBytes: Number(row.iSizeBytes ?? 0),
    sChecksum: text(row.sChecksum) || null,
    sNote: text(row.sNote),
    bDelete: row.bDelete === 1 || row.bDelete === true,
  };
}

export interface SaveFileInput {
  body: Uint8Array;
  sFileName: string;
  sContentType?: string;
  sKind?: FileKind;
  sJobUUID?: string | null;
  sNote?: string;
  /** Exact object key. Without it the key is built from the kind and file name. */
  sStoragePath?: string;
}

/**
 * Bytes go to R2, the row goes to D1. The row is written second so a failed
 * upload never leaves a record pointing at nothing.
 */
export async function saveFile(input: SaveFileInput): Promise<JobFile> {
  const sKind = input.sKind ?? "attachment";
  const sContentType = input.sContentType || "application/octet-stream";
  const key = input.sStoragePath ?? buildKey(sKind, input.sFileName, input.sJobUUID);

  const stored = await getFileStorage().put(key, input.body, sContentType);

  const record: JobFile = {
    uuid: randomUUID(),
    dtDateTime: new Date().toISOString(),
    sJobUUID: input.sJobUUID ?? null,
    sKind,
    sStoragePath: stored.key,
    sFileName: input.sFileName,
    sContentType,
    iSizeBytes: stored.size,
    sChecksum: createHash("sha256").update(input.body).digest("hex").slice(0, 32),
    sNote: input.sNote ?? "",
    bDelete: false,
  };

  const db = await getDb();

  // Re-generating for the same company and role overwrites the object, so the
  // row has to follow rather than collide on the unique storage path.
  const existing = await db.first<{ uuid: string }>("SELECT uuid FROM JobFile WHERE sStoragePath = ?", [stored.key]);
  if (existing?.uuid) {
    record.uuid = String(existing.uuid);
    await db.run(
      "UPDATE JobFile SET dtDateTime = ?, sJobUUID = ?, sKind = ?, sFileName = ?, sContentType = ?,"
        + " iSizeBytes = ?, sChecksum = ?, sNote = ?, bDelete = 0 WHERE uuid = ?",
      [
        record.dtDateTime, record.sJobUUID, record.sKind, record.sFileName, record.sContentType,
        record.iSizeBytes, record.sChecksum, record.sNote, record.uuid,
      ],
    );
    return record;
  }

  await db.run(
    "INSERT INTO JobFile (" + SELECT_FILES + ") VALUES (" + FILE_COLUMNS.map(() => "?").join(", ") + ")",
    [
      record.uuid, record.dtDateTime, record.sJobUUID, record.sKind, record.sStoragePath,
      record.sFileName, record.sContentType, record.iSizeBytes, record.sChecksum, record.sNote, 0,
    ],
  );

  return record;
}

export async function listFiles(filter: { sJobUUID?: string; sKind?: FileKind; limit?: number } = {}): Promise<JobFile[]> {
  const db = await getDb();
  const where = ["bDelete = 0"];
  const params: Array<string | number> = [];

  if (filter.sJobUUID) {
    where.push("sJobUUID = ?");
    params.push(filter.sJobUUID);
  }
  if (filter.sKind) {
    where.push("sKind = ?");
    params.push(filter.sKind);
  }

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = await db.all(
    "SELECT " + SELECT_FILES + " FROM JobFile WHERE " + where.join(" AND ")
      + " ORDER BY datetime(dtDateTime) DESC LIMIT ?",
    [...params, limit],
  );
  return rows.map(rowToFile);
}

export async function getFileRecord(uuid: string): Promise<JobFile | null> {
  const db = await getDb();
  const row = await db.first("SELECT " + SELECT_FILES + " FROM JobFile WHERE uuid = ?", [uuid]);
  return row ? rowToFile(row) : null;
}

export async function readFile(uuid: string): Promise<{ record: JobFile; body: Uint8Array } | null> {
  const record = await getFileRecord(uuid);
  if (!record) return null;
  const object = await getFileStorage().get(record.sStoragePath);
  if (!object) return null;
  return { record, body: object.body };
}

/** Read straight from a storage path, which is what Job.sCoverLetterPath holds. */
export async function readByPath(storagePath: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  return getFileStorage().get(storagePath);
}

/** A short-lived direct link when the driver supports it (R2 does, the local folder does not). */
export async function fileDownloadUrl(uuid: string, expiresInSeconds = 900): Promise<string | null> {
  const record = await getFileRecord(uuid);
  if (!record) return null;
  return getFileStorage().signedUrl(record.sStoragePath, expiresInSeconds, record.sFileName);
}

/** Direct link for a storage path, which is what Job.sCoverLetterPath holds. */
export async function downloadUrlForPath(
  storagePath: string,
  expiresInSeconds = 900,
  downloadName?: string | null,
): Promise<string | null> {
  return getFileStorage().signedUrl(storagePath, expiresInSeconds, downloadName ?? storagePath.split("/").pop() ?? null);
}

export async function deleteFile(uuid: string, hard = false): Promise<boolean> {
  const record = await getFileRecord(uuid);
  if (!record || (record.bDelete && !hard)) return false;

  const db = await getDb();
  if (hard) {
    await getFileStorage().delete(record.sStoragePath);
    const result = await db.run("DELETE FROM JobFile WHERE uuid = ?", [uuid]);
    return result.changes > 0;
  }
  const result = await db.run("UPDATE JobFile SET bDelete = 1 WHERE uuid = ? AND bDelete = 0", [uuid]);
  return result.changes > 0;
}

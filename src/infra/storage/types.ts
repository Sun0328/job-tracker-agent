/** Object storage, kept behind one interface so R2 and the local folder are interchangeable. */
export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  etag: string | null;
  uploadedAt: string | null;
}

export interface FileStorage {
  readonly driver: "r2" | "local-files";
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string, limit?: number): Promise<StoredObject[]>;
  /**
   * Time-limited link the browser can fetch straight from storage, skipping this
   * server entirely. `downloadName` forces a filename on the download. The local
   * driver has no equivalent and returns null.
   */
  signedUrl(key: string, expiresInSeconds?: number, downloadName?: string | null): Promise<string | null>;
}

import type { FileKind } from "@/domain/file";

export type { FileKind } from "@/domain/file";
export { FILE_KINDS } from "@/domain/file";

/** Readable path segment: "Trade Me" -> "Trade-Me". */
export function slugSegment(value: string, limit = 60): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, limit) || "unknown";
}

/**
 * Cover letters live in a folder per company: Company-Name/Company-Name_Role.pdf
 * so the bucket reads like a filing cabinet rather than a pile of timestamps.
 */
export function coverLetterKey(company: string, role: string): string {
  const folder = slugSegment(company);
  return folder + "/" + folder + "_" + slugSegment(role, 80) + ".pdf";
}

/** Keys are grouped by purpose so a bucket listing stays readable. */
export function buildKey(kind: FileKind, filename: string, jobId?: string | null): string {
  const safe = filename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "file";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return jobId ? kind + "/" + jobId + "/" + stamp + "-" + safe : kind + "/" + stamp + "-" + safe;
}

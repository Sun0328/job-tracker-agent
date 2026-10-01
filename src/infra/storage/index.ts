import { createR2Storage, readR2Config } from "@/infra/storage/r2";
import { createLocalFileStorage } from "@/infra/storage/local-files";
import type { FileStorage } from "@/infra/storage/types";

export type { FileKind, FileStorage, StoredObject } from "@/infra/storage/types";
export { FILE_KINDS, buildKey, coverLetterKey, slugSegment } from "@/infra/storage/types";
export { readR2Config, r2Endpoint } from "@/infra/storage/r2";

let cached: FileStorage | null = null;

/** `r2` for Cloudflare R2, `local` for the data/files folder. */
export function selectedFileDriver(): "r2" | "local" {
  const configured = process.env.FILE_STORAGE?.toLowerCase();
  if (configured === "r2" || configured === "local") return configured;
  return readR2Config() ? "r2" : "local";
}

export function getFileStorage(): FileStorage {
  if (!cached) {
    cached = selectedFileDriver() === "r2" ? createR2Storage() : createLocalFileStorage();
  }
  return cached;
}

/** Tests point this at a throwaway folder. */
export function setFileStorage(storage: FileStorage | null) {
  cached = storage;
}

import { createR2Storage, readR2Config } from "@/infra/storage/r2";
import { createR2BindingStorage } from "@/infra/storage/r2-binding";
import { createLocalFileStorage } from "@/infra/storage/local-files";
import type { FileStorage } from "@/infra/storage/types";

export type { FileKind, FileStorage, StoredObject } from "@/infra/storage/types";
export { FILE_KINDS, buildKey, coverLetterKey, slugSegment } from "@/infra/storage/types";
export { readR2Config, r2Endpoint } from "@/infra/storage/r2";

export type FileDriver = "r2" | "r2-binding" | "local";

let cached: FileStorage | null = null;

/**
 * `r2` for Cloudflare R2 over its S3 API (your machine, the CLI),
 * `r2-binding` for R2 through a Worker binding (the deployed demo),
 * `local` for the data/files folder.
 */
export function selectedFileDriver(): FileDriver {
  const configured = process.env.FILE_STORAGE?.toLowerCase();
  if (configured === "r2" || configured === "r2-binding" || configured === "local") return configured;
  return readR2Config() ? "r2" : "local";
}

export function getFileStorage(): FileStorage {
  if (!cached) {
    const driver = selectedFileDriver();
    cached = driver === "r2" ? createR2Storage() : driver === "r2-binding" ? createR2BindingStorage() : createLocalFileStorage();
  }
  return cached;
}

/** Tests point this at a throwaway folder. */
export function setFileStorage(storage: FileStorage | null) {
  cached = storage;
}

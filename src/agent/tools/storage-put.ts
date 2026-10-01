import { saveFile, type JobFile } from "@/data/file-repository";
import type { FileKind } from "@/infra/storage";
import type { Tool } from "@/agent/core/tool";

export interface StoragePutInput {
  body: Uint8Array;
  sFileName: string;
  sContentType?: string;
  sKind?: FileKind;
  sJobUUID?: string | null;
  sNote?: string;
  sStoragePath?: string;
}

/** Writes the object to Cloudflare R2 and indexes it in JobFile. */
export const storagePut: Tool<StoragePutInput, JobFile> = {
  name: "storage_put",
  description: "Upload a file to Cloudflare storage and record it in the database.",

  async run(input) {
    return saveFile(input);
  },

  summarise(_input, output) {
    return output.sStoragePath + " (" + Math.round(output.iSizeBytes / 1024) + "KB)";
  },
};

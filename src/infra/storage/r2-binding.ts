import { cloudflareBindings, type R2BucketLike, type R2ObjectLike } from "@/infra/cloudflare";
import type { FileStorage, StoredObject } from "@/infra/storage/types";

function toStored(object: R2ObjectLike): StoredObject {
  return {
    key: object.key,
    size: object.size,
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    etag: object.etag ?? null,
    uploadedAt: object.uploaded ? new Date(object.uploaded).toISOString() : null,
  };
}

/**
 * R2 through the Worker's own binding. No S3 key pair, so no signed URLs: the
 * API streams the bytes itself, which is what the cover-letter route already
 * does when signedUrl returns null.
 */
export function createR2BindingStorage(): FileStorage {
  const bucket = async (): Promise<R2BucketLike> => {
    const files = (await cloudflareBindings()).FILES;
    if (!files) throw new Error("FILE_STORAGE=r2-binding, but this Worker has no FILES binding (see wrangler.jsonc).");
    return files;
  };

  return {
    driver: "r2-binding",

    async put(key, body, contentType) {
      const stored = await (await bucket()).put(key, body, { httpMetadata: { contentType } });
      return stored
        ? toStored(stored)
        : { key, size: body.byteLength, contentType, etag: null, uploadedAt: new Date().toISOString() };
    },

    async get(key) {
      const object = await (await bucket()).get(key);
      if (!object) return null;
      return {
        body: new Uint8Array(await object.arrayBuffer()),
        contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      };
    },

    async head(key) {
      const object = await (await bucket()).head(key);
      return object ? toStored(object) : null;
    },

    async delete(key) {
      const files = await bucket();
      if (!(await files.head(key))) return false;
      await files.delete(key);
      return true;
    },

    async list(prefix = "", limit = 100) {
      const listing = await (await bucket()).list({ prefix, limit: Math.min(limit, 1000) });
      return listing.objects.map(toStored);
    },

    async signedUrl() {
      return null;
    },
  };
}

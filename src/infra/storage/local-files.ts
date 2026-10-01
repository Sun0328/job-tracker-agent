import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { FileStorage, StoredObject } from "@/infra/storage/types";

const DEFAULT_ROOT = path.join(process.cwd(), "data", "files");

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function guessContentType(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

/** Same contract as R2, backed by data/files — for offline work and tests. */
export function createLocalFileStorage(root = process.env.LOCAL_FILES_PATH || DEFAULT_ROOT): FileStorage {
  const resolve = (key: string) => {
    const target = path.resolve(root, key);
    if (!target.startsWith(path.resolve(root))) throw new Error("Refusing to escape the storage root: " + key);
    return target;
  };

  return {
    driver: "local-files",

    async put(key, body, contentType) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
      return {
        key,
        size: body.byteLength,
        contentType,
        etag: createHash("md5").update(body).digest("hex"),
        uploadedAt: new Date().toISOString(),
      };
    },

    async get(key) {
      try {
        const body = await readFile(resolve(key));
        return { body: new Uint8Array(body), contentType: guessContentType(key) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async head(key) {
      try {
        const info = await stat(resolve(key));
        return {
          key,
          size: info.size,
          contentType: guessContentType(key),
          etag: null,
          uploadedAt: info.mtime.toISOString(),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async delete(key) {
      try {
        await rm(resolve(key));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },

    async list(prefix = "", limit = 100) {
      const objects: StoredObject[] = [];

      const walk = async (directory: string, relative: string) => {
        let entries;
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (objects.length >= limit) return;
          const key = relative ? relative + "/" + entry.name : entry.name;
          if (entry.isDirectory()) {
            await walk(path.join(directory, entry.name), key);
          } else if (key.startsWith(prefix)) {
            const info = await stat(path.join(directory, entry.name));
            objects.push({
              key,
              size: info.size,
              contentType: guessContentType(key),
              etag: null,
              uploadedAt: info.mtime.toISOString(),
            });
          }
        }
      };

      await walk(root, "");
      return objects;
    },

    async signedUrl() {
      // No public URL for a local folder; the API serves these bytes itself.
      return null;
    },
  };
}

import { AwsClient } from "aws4fetch";
import type { FileStorage, StoredObject } from "@/infra/storage/types";

interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export function r2Endpoint(accountId: string): string {
  return "https://" + accountId + ".r2.cloudflarestorage.com";
}

/** Minimal S3 ListObjectsV2 reader — enough for "what is in this prefix". */
function parseListing(xml: string): StoredObject[] {
  const objects: StoredObject[] = [];
  const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
  for (const entry of contents) {
    const value = (tag: string) => entry.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"))?.[1] ?? null;
    const key = value("Key");
    if (!key) continue;
    objects.push({
      key,
      size: Number(value("Size") ?? 0),
      contentType: "application/octet-stream",
      etag: value("ETag")?.replace(/"/g, "") ?? null,
      uploadedAt: value("LastModified"),
    });
  }
  return objects;
}

export function createR2Storage(): FileStorage {
  const config = readR2Config();
  if (!config) {
    throw new Error(
      "R2 is not configured. Set R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (plus CLOUDFLARE_ACCOUNT_ID), or run with FILE_STORAGE=local.",
    );
  }

  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = r2Endpoint(config.accountId) + "/" + config.bucket;
  const objectUrl = (key: string) => base + "/" + key.split("/").map(encodeURIComponent).join("/");

  return {
    driver: "r2",

    async put(key, body, contentType) {
      // A plain ArrayBuffer keeps the exact bytes and satisfies BodyInit.
      const payload = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
      const response = await client.fetch(objectUrl(key), {
        method: "PUT",
        body: payload,
        headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
      });
      if (!response.ok) {
        throw new Error("R2 upload failed (" + response.status + "): " + (await response.text()).slice(0, 300));
      }
      return {
        key,
        size: body.byteLength,
        contentType,
        etag: response.headers.get("etag")?.replace(/"/g, "") ?? null,
        uploadedAt: new Date().toISOString(),
      };
    },

    async get(key) {
      const response = await client.fetch(objectUrl(key));
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error("R2 download failed (" + response.status + "): " + (await response.text()).slice(0, 300));
      }
      return {
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async head(key) {
      const response = await client.fetch(objectUrl(key), { method: "HEAD" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("R2 head failed (" + response.status + ")");
      return {
        key,
        size: Number(response.headers.get("content-length") ?? 0),
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        etag: response.headers.get("etag")?.replace(/"/g, "") ?? null,
        uploadedAt: response.headers.get("last-modified"),
      };
    },

    async delete(key) {
      const response = await client.fetch(objectUrl(key), { method: "DELETE" });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error("R2 delete failed (" + response.status + ")");
      return true;
    },

    async list(prefix = "", limit = 100) {
      const url = new URL(base);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("max-keys", String(limit));
      if (prefix) url.searchParams.set("prefix", prefix);

      const response = await client.fetch(url.toString());
      if (!response.ok) {
        throw new Error("R2 list failed (" + response.status + "): " + (await response.text()).slice(0, 300));
      }
      return parseListing(await response.text());
    },

    async signedUrl(key, expiresInSeconds = 900, downloadName = null) {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
      // S3 response overrides, signed into the URL, so the browser saves it with
      // the right name and type without this server touching the bytes.
      if (downloadName) {
        url.searchParams.set("response-content-disposition", 'attachment; filename="' + downloadName.replace(/"/g, "") + '"');
      }
      const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },
  };
}

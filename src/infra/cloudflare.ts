/**
 * The Cloudflare bindings of the deployed Worker (see wrangler.jsonc). Only the
 * binding drivers call this, and only when JOB_DB / FILE_STORAGE select them, so
 * local Node runs and tests never touch it.
 *
 * The interfaces are the small slice of the D1 and R2 binding APIs this app
 * uses, written out so the app does not depend on @cloudflare/workers-types.
 */

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[]; meta?: { changes?: number } }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<Array<{ results?: T[] }>>;
}

export interface R2ObjectLike {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<R2ObjectLike | null>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: R2ObjectLike[] }>;
}

export interface CloudflareBindings {
  DB?: D1DatabaseLike;
  FILES?: R2BucketLike;
}

/** The bindings for the current request. Throws outside a Worker. */
export async function cloudflareBindings(): Promise<CloudflareBindings> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  return (await getCloudflareContext({ async: true })).env as CloudflareBindings;
}

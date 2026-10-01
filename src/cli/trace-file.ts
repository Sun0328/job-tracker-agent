import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Write a run's trace to data/traces/<stamp>-<name>.json and return the path. */
export async function writeTraceFile(name: string, payload: unknown, directory?: string | null): Promise<string> {
  const target = directory ?? path.join(process.cwd(), "data", "traces");
  await mkdir(target, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(target, stamp + "-" + name + ".json");
  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

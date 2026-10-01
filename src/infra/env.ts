import path from "node:path";

/** .env then .env.local, so the local file wins. Node loads these natively. */
export function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    try {
      process.loadEnvFile(path.join(process.cwd(), file));
    } catch {
      // Missing file is fine.
    }
  }
}

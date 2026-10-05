import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/** Defaults: no incremental cache. Every page that reads data is dynamic anyway. */
export default defineCloudflareConfig({});

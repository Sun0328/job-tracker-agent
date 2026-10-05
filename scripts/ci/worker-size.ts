import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * How big is the Worker Cloudflare would upload? Run after `opennextjs-cloudflare
 * build`; it measures with `wrangler deploy --dry-run`, which uploads nothing.
 *
 * The free plan refuses a Worker over 3 MiB gzipped. CI fails earlier, at the
 * budget, so growth is noticed while there is still room to act on it.
 *
 * CI only. It refuses to run beside a .env, because a Worker built there has the
 * .env values inside it (see .claude/debugging.md).
 */

const LIMIT_KIB = 3072;
const BUDGET_KIB = 2560;
const ROOT = process.cwd();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (existsSync(path.join(ROOT, ".env"))) {
  fail("Refusing to measure a Worker built beside a .env. This check runs in CI, where there is none.");
}
if (!existsSync(path.join(ROOT, ".open-next", "worker.js"))) {
  fail("No Worker to measure: run `npx opennextjs-cloudflare build` first.");
}

const wrangler = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const run = spawnSync(process.execPath, [wrangler, "deploy", "--dry-run", "--outdir", path.join(".wrangler", "dry-run")], {
  cwd: ROOT,
  encoding: "utf8",
});
const output = (run.stdout ?? "") + (run.stderr ?? "");
const sizes = output.match(/Total Upload: ([\d.]+) KiB \/ gzip: ([\d.]+) KiB/);
if (run.status !== 0 || !sizes) fail("wrangler deploy --dry-run did not report a size:\n" + output);

const raw = Number(sizes[1]);
const gzip = Number(sizes[2]);
const share = Math.round((gzip / LIMIT_KIB) * 100);
const verdict = gzip > BUDGET_KIB ? "over budget" : "within budget";
const line = `Worker: ${gzip.toFixed(0)} KiB gzipped (${raw.toFixed(0)} KiB raw), ${share}% of the free plan's ${LIMIT_KIB} KiB limit; budget ${BUDGET_KIB} KiB, ${verdict}.`;
console.log(line);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "### Worker size",
      "",
      "| gzipped | raw | of the 3 MiB free-plan limit | budget |",
      "| --- | --- | --- | --- |",
      `| ${gzip.toFixed(0)} KiB | ${raw.toFixed(0)} KiB | ${share}% | ${BUDGET_KIB} KiB, ${verdict} |`,
      "",
    ].join("\n"),
  );
}

if (gzip > BUDGET_KIB) fail("The Worker is over its size budget. Look for a new dependency pulled into the server bundle.");

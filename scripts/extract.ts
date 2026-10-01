import { createRunTrace } from "@/agent/core/create-trace";
import { NotAJobPostError } from "@/agent/input";
import { EXTRACT_OUTPUT_SHAPE } from "@/agent/prompts/extract-job";
import { runJobExtractor } from "@/agent/steps/job-extractor";
import { flag, loadEnv, option, readJobPostInput } from "@/cli/args";
import { EventPrinter, bold, dim, red, yellow } from "@/cli/render";
import { writeTraceFile } from "@/cli/trace-file";

/** Sub-agent 1 alone: read an advert, return the structured record. Nothing is saved. */
async function main() {
  loadEnv();

  if (flag("schema")) {
    console.log(bold("Sub-agent 1 output contract\n"));
    console.log(EXTRACT_OUTPUT_SHAPE);
    return;
  }

  const jobPost = (await readJobPostInput()).trim();
  if (jobPost.length < 80) {
    console.error("Give me a job advert (min 80 characters). Any of these:");
    console.error("");
    console.error("  npm run extract:clip                        read the advert from your clipboard");
    console.error("  node --import tsx scripts/extract.ts --file ad.txt");
    console.error("  Get-Content ad.txt -Raw | npm run agent:extract");
    console.error("  npm run extract:schema                      print the output contract");
    console.error("");
    console.error("Debugging flags: --trace (write the full trace to data/traces), --quiet, --json, --no-web");
    process.exitCode = 1;
    return;
  }

  const wantsTrace = flag("trace");
  const printer = new EventPrinter({ quiet: flag("quiet") });
  const trace = createRunTrace(jobPost, { onEvent: (event) => printer.print(event) });

  console.log(bold("sub-agent 1: job post extraction")
    + dim("  mode=" + trace.sMode + (trace.sModel ? " model=" + trace.sModel : "") + " input=" + jobPost.length + " chars"));
  console.log(dim("  (no database connection — nothing is saved)\n"));

  const writeTrace = (result: unknown, error: string | null) =>
    writeTraceFile("extract", {
      input: { chars: jobPost.length, text: jobPost },
      result,
      error,
      run: error ? trace.fail(error) : trace.succeed(null),
    }, option("trace-dir"));

  try {
    const result = await runJobExtractor({ jobPost, trace, lookupWebsite: !flag("no-web") });

    console.log("");
    if (!flag("json")) console.log(bold("extracted JSON"));
    console.log(JSON.stringify(result.job, null, 2));

    if (!flag("json")) {
      const empty = Object.entries(result.job)
        .filter(([, value]) => value === null || value === "" || (Array.isArray(value) && !value.length))
        .map(([key]) => key);
      if (empty.length) console.log("\n" + yellow("null / empty: ") + empty.join(", "));
      if (result.repaired) console.log(yellow("note: ") + "the first response failed validation and was repaired");
      if (result.website) {
        console.log(dim("website lookup: " + (result.website.website_url ?? "not found") + " via " + result.website.source
          + " — " + result.website.reason));
      }
    }

    if (wantsTrace) console.log(dim("\ntrace: " + (await writeTrace(result.job, null))));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof NotAJobPostError) {
      console.log("\n" + yellow("stopped: ") + error.message);
      console.log(dim("  why: " + error.reason));
      if (error.looksLike) console.log(dim("  looks like: " + error.looksLike));
      console.log(dim("  nothing was extracted, nothing was saved."));
      if (wantsTrace) console.log(dim("trace: " + (await writeTrace(null, message))));
      process.exitCode = 2;
      return;
    }

    console.error("\n" + red("extraction failed: ") + message);
    // A failure always gets a trace file — that is when you need it most.
    console.error(dim("trace: " + (await writeTrace(null, message))));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(red("failed: ") + (error instanceof Error ? error.message : error));
  process.exitCode = 1;
});

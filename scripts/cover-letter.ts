import { writeFile } from "node:fs/promises";
import path from "node:path";
import { flag, loadEnv, option, readJobPostInput } from "@/cli/args";
import { EventPrinter, bold, dim, red, yellow } from "@/cli/render";
import { writeTraceFile } from "@/cli/trace-file";
import { NoResumeError } from "@/data/resume-repository";
import { getDb } from "@/infra/db";
import { analyseJob } from "@/services/analyse-job";

/** The whole flow on one advert: identify, extract, track, letter. */
async function main() {
  loadEnv();
  const db = await getDb();

  try {
    const jobPost = (await readJobPostInput()).trim();
    if (jobPost.length < 80) {
      console.error("Give me a job advert (min 80 characters):");
      console.error("");
      console.error("  npm run agent:clip                                    from your clipboard");
      console.error("  node --import tsx scripts/cover-letter.ts --file ad.txt");
      console.error("");
      console.error("Options: --no-save (do not touch the database), --no-letter (skip sub-agent 2),");
      console.error("         --json (print the record), --out letter.pdf, --trace (write the run to data/traces)");
      process.exitCode = 1;
      return;
    }

    const printer = new EventPrinter({ showAgent: true });
    const result = await analyseJob({
      request: {
        jobPost,
        coverLetter: !flag("no-letter"),
        save: !flag("no-save"),
        lookupWebsite: !flag("no-web"),
        maxAttempts: 3,
      },
      onEvent: (event) => {
        if (event.type === "run.start") {
          console.log(bold("main agent") + dim("  mode=" + event.sMode + (event.sModel ? " model=" + event.sModel : "")
            + " input=" + event.iInputChars + " chars"));
          console.log("");
        }
        printer.print(event);
      },
    });

    if (flag("trace")) {
      const file = await writeTraceFile("agent", {
        outcome: result.outcome,
        job: result.job,
        warnings: result.warnings,
        error: result.error,
        run: result.run,
      }, option("trace-dir"));
      console.log(dim("\ntrace written to " + file));
    }

    if (result.outcome === "not-a-job-post") {
      console.log("\n" + yellow("stopped: ") + result.error);
      console.log(dim("  why: " + (result.verdict?.sReason ?? "")));
      if (result.verdict?.sLooksLike) console.log(dim("  looks like: " + result.verdict.sLooksLike));
      process.exitCode = 2;
      return;
    }

    if (result.outcome === "failed" || !result.job) {
      console.error("\n" + red("failed after " + result.attempts + " attempt(s): ") + result.error);
      for (const warning of result.warnings) console.log(yellow("warning: ") + warning);
      process.exitCode = 1;
      return;
    }

    const job = result.job;
    console.log("\n" + bold(job.sJobTitle) + " at " + bold(job.sCompany)
      + dim(job.sLocation ? ", " + job.sLocation : "") + dim("  [" + job.sContractType + "]"));
    if (job.sCompanyMeta?.business) console.log(dim("  " + job.sCompanyMeta.business));
    if (job.sCompanyMeta?.website_url) console.log(dim("  " + job.sCompanyMeta.website_url));

    if (flag("json")) console.log("\n" + JSON.stringify(job, null, 2));

    if (result.letter) {
      console.log("\n" + bold("cover letter")
        + dim("  " + result.letter.words + " words, " + result.letter.pages + " page"));
      console.log(dim("resume: ") + (result.letter.resume?.sFileName ?? "?"));
      if (result.letter.resume?.sReason) console.log(dim("  why: " + result.letter.resume.sReason));
      console.log("");
      console.log(result.letter.text);
      if (result.letter.sCoverLetterPath) console.log(dim("\nsaved: " + result.letter.sCoverLetterPath));

      const out = option("out");
      if (out) {
        await writeFile(path.resolve(out), result.letter.bytes);
        console.log(dim("written to " + path.resolve(out)));
      }
    }

    if (result.saved) console.log(dim("\ntracked as " + result.saved.uuid));

    for (const warning of result.warnings) console.log(yellow("warning: ") + warning);
  } catch (error) {
    if (error instanceof NoResumeError) {
      console.error("\n" + yellow(error.message));
      process.exitCode = 2;
      return;
    }
    console.error("\n" + red("cover letter failed: ") + (error instanceof Error ? error.message : error));
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(red("failed: ") + (error instanceof Error ? error.message : error));
  process.exitCode = 1;
});

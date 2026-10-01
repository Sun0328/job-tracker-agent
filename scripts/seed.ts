import { flag, loadEnv, option } from "@/cli/args";
import { getDb, selectedDriver } from "@/infra/db";
import { createJob, updateStatus } from "@/data/job-repository";
import type { ContractType, ExtractedJob, JobSource } from "@/domain";

/** Deterministic RNG so two seed runs produce the same dashboard. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const COMPANIES: Array<[string, string, string]> = [
  ["Xero", "https://www.xero.com", "Accounting Software"],
  ["Datacom", "https://datacom.com", "IT Services"],
  ["Trade Me", "https://www.trademe.co.nz", "Online Marketplace"],
  ["Halter", "https://halterhq.com", "Agritech"],
  ["Auror", "https://auror.co", "Retail Security"],
  ["Sharesies", "https://sharesies.nz", "Financial Services"],
  ["Spark", "https://www.spark.co.nz", "Telecommunications"],
  ["ASB", "https://www.asb.co.nz", "Banking"],
  ["Tend Health", "https://tend.nz", "Healthcare"],
  ["Vista Group", "https://www.vista.co", "Cinema Software"],
];

const ROLES: Array<[string, string[]]> = [
  ["QA Automation Engineer", ["Playwright", "TypeScript", "CI/CD", "Appium"]],
  ["Software Engineer", ["TypeScript", "Node.js", "AWS", "React"]],
  ["Software Engineer in Test", ["TypeScript", "Playwright", "AWS", "Docker"]],
  ["Mobile QA Engineer", ["Appium", "Kotlin", "Swift", "CI/CD"]],
  ["Test Analyst", ["Cypress", "JavaScript", "Azure", "SQL"]],
  ["Automation Engineer", ["Python", "Docker", "Kubernetes", "GraphQL"]],
];

const SOURCES: JobSource[] = ["SEEK", "LinkedIn", "Company Website", "Trade Me Jobs", "Other"];
const CONTRACTS: ContractType[] = ["Permanent", "Permanent", "Permanent", "Fixed-term", "Contract"];
const LOCATIONS = ["Auckland Central", "Takapuna", "Silverdale", "Auckland (hybrid)", "Wellington", "Remote, NZ"];

function isoDaysAgo(days: number, hour = 9): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function buildJob(index: number, random: () => number): ExtractedJob {
  const [sCompany, website, industry] = COMPANIES[Math.floor(random() * COMPANIES.length)];
  const [sJobTitle, tech] = ROLES[index % ROLES.length];
  const sSource = SOURCES[Math.floor(random() * SOURCES.length)];
  const bAgency = random() < 0.2;

  return {
    sCompany: bAgency ? "Robert Walters" : sCompany,
    bAgency,
    sCompanyMeta: bAgency
      ? null
      : { industry, business: sCompany + " builds software used across New Zealand.", website_url: website },
    sJobTitle,
    sJobRequirement: ["- 3+ years in a similar role", "- Strong scripting skills", "- CI/CD experience"].join("\n"),
    sContractType: CONTRACTS[Math.floor(random() * CONTRACTS.length)],
    sLocation: LOCATIONS[Math.floor(random() * LOCATIONS.length)],
    sJobSummary: "Seed data for dashboard development. " + sJobTitle + " working across delivery and quality.",
    sSource,
    sSourceUrl: sSource === "SEEK" ? "https://www.seek.co.nz/job/" + (70000000 + index) : null,
    sTechStack: [...tech],
  };
}

async function main() {
  loadEnv();

  const count = Number(option("count") ?? 24);
  const db = await getDb();
  console.log("driver: " + selectedDriver() + " (" + db.driver + ")");

  if (flag("reset")) {
    for (const table of ["AgentRunStep", "AgentRun", "JobFile", "Job"]) {
      await db.run("DELETE FROM " + table);
    }
    console.log("cleared Job, JobFile and AgentRun");
  }

  const random = rng(20260915);
  let applied = 0;
  let responded = 0;
  let offers = 0;

  for (let index = 0; index < count; index += 1) {
    const daysAgo = Math.floor(random() * 90) + 1;
    const job = await createJob(buildJob(index, random), { dtDateTime: isoDaysAgo(daysAgo) });

    // 15% never get sent.
    if (random() < 0.15) continue;

    const appliedDay = Math.max(daysAgo - Math.floor(random() * 3), 1);
    await updateStatus(job.uuid, "Applied", "Applied online", { when: isoDaysAgo(appliedDay, 10) });
    applied += 1;

    if (random() >= 0.42) {
      if (random() < 0.5 && appliedDay > 14) {
        await updateStatus(job.uuid, "Reject", "Rejection email", { when: isoDaysAgo(Math.max(appliedDay - 12, 1), 11) });
      }
      continue;
    }

    const screenDay = Math.max(appliedDay - (Math.floor(random() * 10) + 3), 1);
    await updateStatus(job.uuid, "HR screen", "Recruiter call", { when: isoDaysAgo(screenDay, 11) });
    responded += 1;

    if (random() >= 0.6) {
      await updateStatus(job.uuid, "Reject", "Not progressing after the screen", { when: isoDaysAgo(Math.max(screenDay - 4, 1), 12) });
      continue;
    }

    const techDay = Math.max(screenDay - (Math.floor(random() * 7) + 2), 1);
    await updateStatus(job.uuid, "Tech interview", "Technical round", { when: isoDaysAgo(techDay, 13) });

    if (random() >= 0.55) {
      await updateStatus(job.uuid, "Reject", "Went with another candidate", { when: isoDaysAgo(Math.max(techDay - 5, 1), 14) });
      continue;
    }

    const behaviourDay = Math.max(techDay - (Math.floor(random() * 6) + 2), 1);
    await updateStatus(job.uuid, "Behavior interview", "Values interview", { when: isoDaysAgo(behaviourDay, 13) });

    if (random() >= 0.6) {
      await updateStatus(job.uuid, "Reject", "Not the right fit", { when: isoDaysAgo(Math.max(behaviourDay - 4, 1), 14) });
      continue;
    }

    const finalDay = Math.max(behaviourDay - (Math.floor(random() * 5) + 2), 1);
    await updateStatus(job.uuid, "Final", "Final round", { when: isoDaysAgo(finalDay, 13) });

    if (random() < 0.45) {
      await updateStatus(job.uuid, "Offer", "Offer received", { when: isoDaysAgo(Math.max(finalDay - 3, 1), 15) });
      offers += 1;
    }
  }

  console.log("\nseeded " + count + " jobs: " + applied + " applied, " + responded + " responded, " + offers + " offers");
  console.log("run `npm run metrics` or open /dashboard.");
  await db.close();
}

main().catch((error) => {
  console.error("seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

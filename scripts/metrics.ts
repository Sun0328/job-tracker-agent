import { flag, loadEnv, option } from "@/cli/args";
import { getDb, selectedDriver } from "@/infra/db";
import { getDashboardMetrics } from "@/data/metrics";

function bar(value: number, max: number, width = 28): string {
  if (max <= 0) return "";
  return "#".repeat(Math.max(Math.round((value / max) * width), value > 0 ? 1 : 0));
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

async function main() {
  loadEnv();

  const windowDays = option("window") ? Number(option("window")) : null;
  const db = await getDb();
  const metrics = await getDashboardMetrics({ windowDays });

  if (flag("json")) {
    console.log(JSON.stringify(metrics, null, 2));
    await db.close();
    return;
  }

  const { totals, rates, funnel, agent } = metrics;
  console.log("JOB HUNT DASHBOARD  (" + selectedDriver() + (windowDays ? ", last " + windowDays + " days" : ", all time") + ")");
  console.log("=".repeat(62));

  console.log("\nTOTALS");
  console.log("  tracked " + totals.tracked + "   applied " + totals.applied + "   active " + totals.active
    + "   interviewing " + totals.interviewing);
  console.log("  offers " + totals.offers + "   rejected " + totals.rejected
    + "   via agency " + totals.viaAgency + "   waiting on a reply " + totals.awaitingResponse);

  console.log("\nRATES");
  console.log("  response " + rates.responseRate + "%   interview " + rates.interviewRate + "%   offer "
    + rates.offerRate + "%   rejection " + rates.rejectionRate + "%");
  console.log("  days to first response: avg " + (rates.avgDaysToFirstResponse ?? "-")
    + ", median " + (rates.medianDaysToFirstResponse ?? "-"));

  console.log("\nFUNNEL");
  const top = funnel[0]?.count ?? 0;
  for (const stage of funnel) {
    console.log("  " + pad(stage.stage, 16) + pad(String(stage.count), 5) + pad(bar(stage.count, top), 30)
      + " " + stage.conversionFromPrevious + "% of previous");
  }

  if (metrics.weeklyApplications.length) {
    console.log("\nAPPLICATIONS PER WEEK");
    const peak = Math.max(...metrics.weeklyApplications.map((week) => week.applications));
    for (const week of metrics.weeklyApplications) {
      console.log("  " + week.week + "  " + pad(String(week.applications), 4) + pad(bar(week.applications, peak, 20), 22)
        + " " + week.responses + " responses");
    }
  }

  if (metrics.bySource.length) {
    console.log("\nBY SOURCE");
    for (const source of metrics.bySource) {
      console.log("  " + pad(source.sSource, 18) + pad(source.applications + " applied", 14)
        + pad(source.interviews + " interviews", 16) + source.interviewRate + "%");
    }
  }

  if (metrics.topTech.length) {
    console.log("\nTECH IN THE ADVERTS YOU CHASE");
    console.log("  " + metrics.topTech.map((tech) => tech.tech + " (" + tech.jobs + ")").join(", "));
  }

  if (metrics.staleApplications.length) {
    console.log("\nSITTING WITHOUT AN ANSWER");
    for (const item of metrics.staleApplications.slice(0, 6)) {
      console.log("  " + pad(item.daysSinceUpdate + "d", 6) + pad(item.sStatus, 20) + item.sCompany + " — " + item.sJobTitle);
    }
  }

  console.log("\nAGENT");
  console.log("  runs " + agent.runs + " (" + agent.succeeded + " ok, " + agent.failed + " failed), repair rate "
    + agent.repairRate + "%, avg " + (agent.avgDurationMs ?? "-") + "ms, " + agent.totalTokens + " tokens");

  await db.close();
}

main().catch((error) => {
  console.error("metrics failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

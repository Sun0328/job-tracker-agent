/**
 * The dashboard's date range: applications first tracked in the last N days.
 *
 * Defined once and used by the job list, the numbers and the pipeline graph,
 * so all three always count the same rows. When they disagreed, the table
 * listed jobs the graph did not contain, and changing one of those jobs'
 * status could not move the graph.
 */

/** null means all time. Anything else is clamped to 1..3650 whole days. */
export function normaliseWindow(windowDays: number | null | undefined): number | null {
  if (windowDays == null) return null;
  return Math.min(Math.max(Math.round(Number(windowDays) || 0), 1), 3650);
}

/** The SQL condition for "tracked inside the window", or null for all time. */
export function trackedWithin(windowDays: number | null | undefined, column = "dtDateTime"): string | null {
  const days = normaliseWindow(windowDays);
  return days ? "datetime(" + column + ") >= datetime('now', '-" + days + " days')" : null;
}

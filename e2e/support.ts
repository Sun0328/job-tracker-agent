import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/** Shared by the browser tests: where they point, and what the seed holds. */

export const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || "http://localhost:3300";
export const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);

/** Applications in demo/seed.sql: what the live demo holds right after a reset. */
export const SEED_JOBS = (readFileSync(path.join(process.cwd(), "demo", "seed.sql"), "utf8").match(/^INSERT INTO Job \(/gm) ?? []).length;

export interface Health {
  ok: boolean;
  driver: string;
  database: { ok: boolean; jobs?: number };
  files: { driver: string; ok: boolean };
  agent: { mode: string; model: string | null };
  version: string | null;
}

/**
 * Collect what a page reports as broken: uncaught errors, console errors and
 * server errors. Call before navigating; read the array at the end.
 */
export function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push("page error: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push("console: " + message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(response.status() + " " + response.url());
  });
  return problems;
}

/** Table cells whose content is wider than the cell: text that runs into the next column. */
export async function overflowingCells(page: Page): Promise<string[]> {
  return page.locator("tbody tr.row-toggle td").evaluateAll((cells) =>
    cells
      .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
      .map((cell) => cell.getAttribute("data-label") + ": " + (cell.textContent ?? "").trim().slice(0, 40)));
}

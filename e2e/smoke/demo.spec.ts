import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { SEED_JOBS, overflowingCells, watchForErrors, type Health } from "../support";

/**
 * Read-only checks of a running demo. These run after every deploy against the
 * live Worker, so nothing here may change data: no AI run, no status change, and
 * the refused writes target ids that do not exist.
 */

test.describe("smoke", () => {
  test("health: database and storage reachable, demo mode on", async ({ request }) => {
    const health = (await (await request.get("/api/health")).json()) as Health;
    expect(health).toMatchObject({ ok: true, database: { ok: true }, files: { ok: true } });
    // Visitors cannot delete, so the demo never holds fewer than the seed. Right after a reset, exactly the seed.
    if (process.env.EXPECT_SEED) expect(health.database.jobs).toBe(SEED_JOBS);
    else expect(health.database.jobs).toBeGreaterThanOrEqual(SEED_JOBS);

    const demo = await (await request.get("/api/demo")).json();
    expect(demo).toMatchObject({ demo: true, resume: { url: "/api/demo/resume" } });
  });

  test("analyse page: the intro, and the example advert loads into the box", async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto("/");
    await expect(page.getByText("Load the example advert.")).toBeVisible();

    await page.getByRole("button", { name: "Use the example advert" }).click();

    await expect(page.locator("textarea")).toHaveValue(/Northwind Insight/);
    await expect(page.getByRole("button", { name: "Example advert loaded" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Run the agent" })).toHaveAttribute("data-attention", "true");
    expect(problems).toEqual([]);
  });

  test("dashboard: the table, the tiles and the graph count the same applications", async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto("/dashboard");
    const rows = page.locator("tbody tr.row-toggle");
    await expect(rows.first()).toBeVisible();

    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(SEED_JOBS);
    await expect(page.getByText(count + " tracked", { exact: true })).toBeVisible();
    await expect(page.locator(".tile", { hasText: "Tracked" }).locator(".tile-value")).toHaveText(String(count));
    await expect(page.getByRole("img", { name: "Job pipeline flow" }).getByText("Tracked " + count, { exact: true })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("dashboard: no table text runs into the next column, at common widths", async ({ page }) => {
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      await expect(page.locator("tbody tr.row-toggle").first()).toBeVisible();
      expect(await overflowingCells(page), width + "px").toEqual([]);
    }
  });

  test("a seeded cover letter downloads as a PDF", async ({ request }) => {
    const { jobs } = (await (await request.get("/api/jobs?limit=50")).json()) as { jobs: Array<{ uuid: string; sCoverLetterPath: string | null }> };
    const withLetter = jobs.find((job) => job.sCoverLetterPath);
    expect(withLetter, "a job with a letter").toBeTruthy();

    const response = await request.get("/api/jobs/" + withLetter!.uuid + "/cover-letter");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("the fictional CV downloads as a PDF", async ({ request }) => {
    const response = await request.get("/api/demo/resume");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("every write except a status change is refused as a demo action", async ({ request }) => {
    // Ids that do not exist: were demo mode ever off, these would be 404s, not damage.
    const ghost = randomUUID();
    const attempts = [
      request.post("/api/jobs", { data: { sCompany: "Smoke test" } }),
      request.patch("/api/jobs/" + ghost, { data: { sNote: "smoke test" } }),
      request.delete("/api/jobs/" + ghost),
      request.delete("/api/runs/" + ghost),
      request.delete("/api/files/" + ghost),
      request.post("/api/files", { multipart: { sNote: "smoke test" } }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status(), response.url()).toBe(403);
      expect(await response.json()).toMatchObject({ demo: true, code: "demo-read-only" });
    }
  });
});

import { expect, test, type Page } from "@playwright/test";
import { DEMO_EXAMPLE_ADVERT } from "../../src/components/demo-example";
import { watchForErrors } from "../support";

/**
 * What an HR visitor does on the demo, start to finish, in one browser (one
 * visitor cookie). Runs against the local build only: it uses the visitor's one
 * AI run (offline, no model key) and changes a status.
 */

const graphCount = async (page: Page, stage: string): Promise<number> => {
  const label = page.getByRole("img", { name: "Job pipeline flow" }).locator("text").filter({ hasText: new RegExp("^" + stage + " \\d+$") });
  return Number((await label.textContent())?.match(/\d+$/)?.[0] ?? NaN);
};

test("analyse the example, download the letter, track it, move it on, and be refused a second run", async ({ page }) => {
  const problems = watchForErrors(page);

  // 1. Load the example advert and run the agent.
  await page.goto("/");
  await page.getByRole("button", { name: "Use the example advert" }).click();
  await page.getByRole("button", { name: "Run the agent" }).click();

  // 2. The run streams its steps and ends with the letter.
  await expect(page.getByText("Is this a job advertisement?").first()).toBeVisible({ timeout: 30_000 });
  const download = page.getByRole("link", { name: "Download the PDF" });
  await expect(download).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".letter")).toContainText("Alex Rivera");

  // 3. The letter downloads as a PDF.
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^\/api\/jobs\/[0-9a-f-]{36}\/cover-letter$/);
  const pdf = await page.request.get(href!);
  expect(pdf.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.pdf"$/);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const uuid = href!.split("/")[3];

  // 4. "Track it on the dashboard" opens that application's row.
  await page.getByRole("link", { name: "Track it on the dashboard" }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard\\?job=" + uuid + "$"));
  // The offline parser reads the title; the company name needs the model, so it is not checked here.
  const row = page.locator("tbody tr.row-toggle[data-open='true']");
  await expect(row).toContainText("AI Engineer (LLM Applications)");
  await expect(row.getByRole("combobox", { name: "Status — Saved" })).toBeVisible();

  // 5. Moving it to Applied moves the graph with it, and survives a reload.
  const appliedBefore = await graphCount(page, "Applied");
  await row.getByRole("combobox", { name: "Status — Saved" }).click();
  await page.getByRole("option", { name: "Applied", exact: true }).click();
  await expect(row.getByRole("combobox", { name: "Status — Applied" })).toBeVisible();
  await expect.poll(() => graphCount(page, "Applied")).toBe(appliedBefore + 1);

  await page.reload();
  await expect(row.getByRole("combobox", { name: "Status — Applied" })).toBeVisible();

  // 6. A second run from the same visitor is refused with the demo message, before any request.
  await page.goto("/");
  await page.getByRole("button", { name: "Use the example advert" }).click();
  await page.getByRole("button", { name: "Run the agent" }).click();
  const toast = page.locator(".toast", { hasText: "Demo environment" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("you have used yours");

  expect(problems).toEqual([]);
});

test("the server refuses a second run even when the page is bypassed", async ({ request }) => {
  // A new visitor (this request context has no cookie yet) calls the API directly.
  const first = await request.post("/api/agent", { data: { jobPost: DEMO_EXAMPLE_ADVERT } });
  expect(first.status()).toBe(200);
  expect(first.headers()["set-cookie"]).toMatch(/^jp_demo=[0-9a-f-]{36}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/);

  // The request context keeps the cookie, as a browser would.
  const again = await request.post("/api/agent", { data: { jobPost: DEMO_EXAMPLE_ADVERT } });
  expect(again.status()).toBe(429);
  expect(await again.json()).toMatchObject({ demo: true, code: "demo-visitor" });
});

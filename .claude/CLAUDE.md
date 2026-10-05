# JobPilot — notes for Claude

Fiona's personal job-application agent. Paste an advert, and the agent checks it is a job post,
extracts a structured record, tracks it, and writes a one-page cover letter. Next.js 15 (App Router)
on Node, Cloudflare D1 for records, Cloudflare R2 for files. Every model call is DeepSeek
(`deepseek-flash`, a reasoning model).

How it fits together: @architecture.md
What went wrong before, and how it was found: @debugging.md
The human-facing version of the architecture, with diagrams: `docs/ARCHITECTURE.md`.

## Rules

- **Layers are lint-enforced.** A layer imports only from the layers below it (table in
  architecture.md). `npx eslint .` fails on a crossing; fix the design, not the rule.
- **Jev / TypeSafe is gone (removed 2026-10-01), and so is the CV match rating.** Do not bring either
  back unless Fiona asks. The `Job.sMatch / iMatchScore / sMatchMeta` columns from migration `0005`
  still exist in D1 but nothing reads them.
- **Never edit an applied migration.** Add `db/migrations/000N_*.sql` instead.
- **Every model call records why.** On the step:
  `step.detail({ ...modelDetail(result), raw: result.content.slice(0, 4000), … })`
  (`src/agent/core/model-detail.ts`). The web inspector reads `raw`, `reasoning` and `instructions`.
- **Every tool call goes through `callTool`**, so it is timed and shows up in the trace and the UI.
- **Any browser-side write that changes the job list calls `clearCache()`**
  (`src/components/dashboard-data.ts`), or the dashboard shows a stale list.
- **Do not test the web UI against the real database.** The analyse page always posts `save: true`.
  Use `npm run e2e` (its own seeded copy of the demo, checked by `e2e/global-setup.ts` before any test)
  or the isolated test server in debugging.md.
- **Never `next build` while a dev server runs.** They share `.next/`. The e2e server builds into
  `.next-e2e/` (`NEXT_DIST_DIR`), so `npm run e2e` is safe beside a dev server on another port.
- **Never run `opennextjs-cloudflare build`, `wrangler dev` or `wrangler deploy` in the project folder.**
  The Cloudflare adapter embeds every `.env` value in the Worker, Next copies `.env` into the bundle,
  and wrangler loads `.env` on its own. Use `npm run demo:deploy` (clean room in `data/demo/build`,
  then a scan for every `.env` value). An in-place build on 2026-10-05 also patched
  `node_modules/next` to always pick its production runtime, which broke `next dev` (`npm ci` fixed it).
- **The public demo is DEMO_MODE=1 with its own D1 (`jobpilot-demo`) and R2 (`jobpilot-demo-files`).**
  Live at https://jobpilot-demo.fionasundev.workers.dev. Cloudflare Workers Builds deploys every push to
  `master` (build `npm run cf:build`, which runs typecheck + lint + unit tests before
  `opennextjs-cloudflare build`; deploy `npx wrangler deploy`), so pushing IS deploying. `/api/health`
  reports the deployed commit as `version`; `deploy-verify.yml` waits for it, then runs the smoke suite live.
  Runtime secrets `DEEPSEEK_API_KEY` and `DEMO_SECRET` are set on the Worker in the dashboard.
  `wrangler.jsonc` is the demo; `wrangler.real.toml` is the private admin config for the real database.
  Demo data is fictional (Microsoft sample-company names, candidate Alex Rivera). Never put anything real
  in `demo/`.
- **No secrets in tracked files.** `.env`, `data/candidate.json`, `data/highlights.md`,
  `data/jobpilot.db`, `data/files/` and `data/traces/` are gitignored. Keep them that way.
- **Git:** `origin` is `https://github.com/Sun0328/job-tracker-agent.git`, branch `master`. The repo
  has a local `credential.https://github.com.username Sun0328` override for her personal account.
  Commit and push only when Fiona asks.

## Done means

```bash
npm run verify        # typecheck + lint + vitest (88 tests as of 2026-10-05)
npm run e2e           # Playwright: production build, seeded demo, offline agent (9 tests)
```

For UI changes, also add or extend a spec under `e2e/` (smoke = read-only, safe against the live
demo; journey = writes, local only). CI (`.github/workflows/ci.yml`) also builds the Worker, checks its
size budget, scans for secrets and audits production dependencies; see docs/ARCHITECTURE.md.

## Commands

```bash
npm run dev                 # web app on :3000 (analyse page /, dashboard /dashboard)
npm run agent:clip          # whole flow on the clipboard advert, from the terminal
npm run agent:dry           # same, nothing saved
npm run extract:clip        # extractor only
npm run cv:list             # CVs the agent can see (R2 resume/)
npm run metrics             # dashboard numbers in the terminal
npm run db:migrate          # apply db/migrations to the selected database
npm run check:model         # which DeepSeek model ids the key can call
npm run demo:local          # the public demo on :3200, from demo/seed.sql (local throwaway DB)
npm run demo:data           # rebuild demo/seed.sql + demo/bucket/ (real DeepSeek runs, local DB)
npm run demo:reset          # load the seed and files into the demo D1 and R2
npm run demo:deploy         # clean-room build, secret scan, deploy (needs a Workers-edit token)
npm run test:coverage       # vitest with the coverage floor CI enforces (vitest.config.ts)
npm run e2e                 # both browser suites on a fresh local build (:3300)
npm run e2e:serve -- --dev  # the e2e server on next dev, for writing specs (then E2E_REUSE=1 npm run e2e)
BASE_URL=https://jobpilot-demo.fionasundev.workers.dev npm run e2e:smoke   # read-only, against live
```

PowerShell swallows a bare `--`: quote it (`npm run x "--" "--flag"`) or call
`node --import tsx scripts/<name>.ts …` directly.

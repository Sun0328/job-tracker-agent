# Debugging notes

What was found the hard way. Newest first. Each entry: what it looked like, the cause, and the fix
or procedure.

## Building the Cloudflare Worker leaked .env and broke `next dev` (2026-10-05)

- **Looked like:** a local `wrangler dev` of the Worker reported `"driver":"d1"` with 9 jobs: it was
  reading the REAL database. The built `.open-next/cloudflare/next-env.mjs` and
  `server-functions/default/.env` held the real Cloudflare token and DeepSeek key.
- **Cause:** `@opennextjs/cloudflare` reads `.env`, `.env.local` and `.env.production*` from the app
  folder at build time and embeds the values; Next copies `.env` into the server bundle; wrangler itself
  loads `.env` for `dev`, `whoami` and friends.
- **Fix:** `npm run demo:deploy` builds in `data/demo/build` (tracked files only, its own `npm ci`), then
  scans `.open-next` for every `.env` value of 16+ characters except public ones (`*_BASE_URL`,
  `*_MODEL`), and refuses to deploy on a match. Nothing was deployed from the leaky build.
- **Second casualty:** one clean-room attempt linked `node_modules` as a junction, and the adapter's
  build patched the shared `node_modules/next/.../module.compiled.js` to `"production" === 'development'`.
  Afterwards `next dev` served every page as 500 (`ENOENT .next/required-server-files.json`) while API
  routes worked. Tell: the compiled `.next/server/app/page.js` references `app-page.runtime.prod.js`.
  `npm ci` restored it. The clean room now installs its own packages.

## Demo deploy refused: "No access to the specified resource" (2026-10-05)

- The token in `.env` has D1 and R2 edit but no Workers permission, so `wrangler deploy` fails on
  `/workers/scripts/jobpilot-demo/...`. Fix: add **Account > Workers Scripts > Edit** to that token, or
  put a token from the "Edit Cloudflare Workers" template in `.env` as `CLOUDFLARE_DEPLOY_TOKEN`.
- `wrangler whoami` reports the `.env` token even with the variable unset in the shell, because wrangler
  reads `.env` itself. There is no OAuth login on this machine.

## Windows: arguments with "; " break through a shell (2026-10-05)

- `spawnSync("npx", [...], { shell: true })` split `--content-type=text/markdown; charset=utf-8` and
  wrangler printed its usage. The demo scripts run `node_modules/wrangler/bin/wrangler.js` with
  `process.execPath` and no shell.

## Changing a status did not move the pipeline graph (fixed 2026-10-05)

- **Looked like:** pick a new status in the Applications table, the toast says it saved, the graph
  stays the same. Reproduced on the isolated server: with "All time" the graph did move; with
  "7 days" it did not.
- **Cause 1 (the main one):** the date range filtered the tiles and the graph by when a job was first
  tracked (`dtDateTime`), but the table always listed every job. Changing an older job changed a
  row the graph never contained. With the real data, 6 of 8 jobs date from 2026-09-15, so the 7- and
  14-day views hid most of them from the graph only.
- **Cause 2:** `data/pipeline.ts` drew any job whose furthest stage was Offer as an Offer, so
  Offer → Reject never showed.
- **Cause 3:** the "waiting" ribbons (Not applied yet, No reply yet, Waiting) were coloured with
  `var(--ink-muted)`, which is not defined, so the browser drew no stroke. Moving a job into one of
  those states looked like nothing happened. Labels used the undefined `var(--ink-secondary)` too.
- **Fix:** one window rule in `data/window.ts` (`trackedWithin`), used by `listJobs({ windowDays })`,
  `metrics` and `pipeline`. `GET /api/jobs` takes `windowDays`, and the dashboard caches the list per
  range, so the table, the tiles and the graph always count the same rows. The table says which range
  it shows and offers "Show all time". Offer then Reject draws Offer → Rejected. Waiting ribbons use
  `var(--axis)`, labels `var(--foreground)`. Loads are ticketed so an older response cannot land last.
- **Guard:** `tests/data/pipeline.test.ts` checks the list, the tiles and the graph agree in every
  range, that a status change moves the graph, and the Offer → Reject case. All three fail on the old
  code.
- **Lesson:** grep for `var(--` names before using one. `globals.css` defines `--foreground`,
  `--muted-foreground`, `--axis`, `--series-*`, `--good`, `--warning`, `--critical`, nothing `--ink-*`.

## A newly analysed job is missing from the dashboard (fixed 2026-10-01)

- **Looked like:** the Applications table showed 6 rows while the database had 7. The missing one
  had been saved by a run minutes earlier.
- **Cause:** `components/dashboard-data.ts` keeps the job list in a module-scoped cache that
  survives client-side navigation. The analyse page saved a job but never cleared it.
- **Fix:** the analyse page calls `clearCache()` when the result has `saved`. Any new write from
  the browser that changes the list must do the same.

## "Order the jobs newest first" — it already was (2026-10-01)

- **Looked like:** the rows seemed unordered.
- **Cause:** `GET /api/jobs` already sorts by `datetime(dtDateTime) DESC`, but "Added" showed only
  `dtDateTime.slice(0, 10)`. Every row read 2026-09-15, so the order was invisible. That slice is
  also the **UTC** date, which in New Zealand can be off by a day.
- **Fix:** "Added" shows the local date with the time underneath (`addedAt()` in
  `app/dashboard/page.tsx`), and the client sorts by `dtDateTime` desc too.
- **Lesson:** before changing a sort, read the real timestamps (snippet below). The data may
  already be right.

## "Why did the agent decide that?" — the reasoning was being thrown away (2026-10-01)

- `deepseek-flash` returns `reasoning_content`. `infra/llm/deepseek.ts` used to count its
  characters (`reasoningChars`) and drop the text. `ChatResult.reasoning` now keeps it, and
  `modelDetail()` puts it on the step, capped at 6000 chars to keep the stored run small.
- Runs saved before this have no `reasoning`, and their step 1 has no `raw`.
- If a model step shows nothing under "How the model reasoned", check that it spreads
  `...modelDetail(result)` into `step.detail`.

## DeepSeek returns an empty answer

- `finish_reason: "length"` with empty `content` means it spent the whole budget reasoning. The
  error says "spent the whole token budget reasoning". Raise `maxTokens`, or leave it uncapped.
  `MIN_MAX_TOKENS` is 1500 for that reason.

## Removing a metrics query broke unrelated numbers (2026-10-01)

- `data/metrics.ts` reads its batch results **by position**. Dropping query 12 (`byMatch`) meant
  "agent health" moved from `results[13]` to `results[12]`. Renumber the comments and every index
  after the change.

## Jev / CV match removal (2026-10-01)

- Removed: `infra/llm/jev.ts`, the `jev` tool, the `match-rater` step, `prompts/match.ts`,
  `domain/match.ts`, `services/rate-job.ts`, `/api/jobs/:id/match`, the match breakdown UI, the
  dashboard "CV fit" column, metrics `byMatch`, and `npm run match`, `match:all`, `check:jev`.
- Kept: migration `0005_job_match.sql` (already applied to D1). Its columns are unused.
- The local `.env` may still hold `TYPESAFE_*` lines. Nothing reads them.

## Seeing it work in the browser without touching real data

The analyse page always saves (`save: true`), and `.env` points at the real D1 and R2. Run a second
dev server on a **copy** of the local database:

```bash
S=<scratch dir>
cp data/jobpilot.db "$S/jobpilot-test.db"
JOB_DB=local LOCAL_DB_PATH="$S/jobpilot-test.db" node --import tsx scripts/db-migrate.ts
JOB_DB=local LOCAL_DB_PATH="$S/jobpilot-test.db" FILE_STORAGE=local npx next dev -p 3100
curl -s localhost:3100/api/health   # must say "driver":"local" and files "driver":"local" before you run anything
```

- `data/files` has no CVs, so the cover-letter step skips and nothing is written there. To isolate
  files completely, set `LOCAL_FILES_PATH` to a scratch folder as well.
- The first request compiles the page, which takes a few seconds. Wait for it.
- **Stopping the background task leaves `next dev` running.** Find the PID that listens on the port
  (`Get-NetTCPConnection -LocalPort 3100 -State Listen`) and stop it, or the port stays taken.
- Only do this when no other dev server is running in the project. Two `next dev` processes share
  `.next/`.

## Driving the analyse page from browser automation

- The textarea is a controlled React field. Setting `.value` before hydration finishes does
  nothing, and the counter stays at "0 characters". After the page has loaded, set it through the
  native setter, then send an `input` event:
  `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(area, text); area.dispatchEvent(new Event("input", { bubbles: true }))`.
- Then click "Run the agent". Steps stream into the right-hand panel. Click one to inspect it.

## Reading the database from the shell

The real database is whichever one `.env` selects (D1 normally). This reads it through the app's
own adapter:

```bash
node --import tsx --disable-warning=ExperimentalWarning --input-type=module -e '
const env = await import("./src/infra/env.ts"); (env.loadEnv ?? env.default?.loadEnv)();
const dbm = await import("./src/infra/db/index.ts"); const db = await (dbm.getDb ?? dbm.default.getDb)();
console.log(await db.all("SELECT substr(uuid,1,8) id, sCompany, sStatus, bError, dtDateTime FROM Job WHERE bDelete = 0 ORDER BY datetime(dtDateTime) DESC LIMIT 10"));
await db.close();'
```

Import `src/infra/...` directly, with the `default` fallbacks shown. Importing `loadEnv` from
`src/cli/args.ts` this way failed ("loadEnv is not a function"); the form above works. Prefix with
`JOB_DB=local LOCAL_DB_PATH=…` to read a local copy instead.

## Housekeeping traps

- **Another session may be editing this repo at the same time.** On 2026-10-01, `.env.example`
  changed mid-task without Claude touching it. Run `git status` / `git diff` before assuming a file
  is the way you left it.
- **An empty top-level `agent/` folder** sometimes cannot be deleted ("Device or resource busy").
  Another process holds it. Delete it by hand later. Git does not track empty folders.
- **CRLF warnings** on `git add` ("LF will be replaced by CRLF") are harmless on this machine.
- **Pushing:** the machine's default GitHub account is the work one. This repo pins `Sun0328`
  locally, so `git push` works non-interactively with `GCM_INTERACTIVE=never`.

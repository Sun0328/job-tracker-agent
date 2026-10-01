# Debugging notes

What was found the hard way. Newest first. Each entry: what it looked like, the cause, and the fix
or procedure.

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

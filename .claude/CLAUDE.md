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
  Use the isolated test server in debugging.md.
- **Never `next build` while a dev server runs.** They share `.next/`.
- **No secrets in tracked files.** `.env`, `data/candidate.json`, `data/highlights.md`,
  `data/jobpilot.db`, `data/files/` and `data/traces/` are gitignored. Keep them that way.
- **Git:** `origin` is `https://github.com/Sun0328/job-tracker-agent.git`, branch `master`. The repo
  has a local `credential.https://github.com.username Sun0328` override for her personal account.
  Commit and push only when Fiona asks.

## Done means

```bash
npx tsc --noEmit
npx eslint .
npx vitest run        # 54 tests as of 2026-10-01
```

For UI changes, also see it working in the browser (isolated test server, debugging.md).

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
```

PowerShell swallows a bare `--`: quote it (`npm run x "--" "--flag"`) or call
`node --import tsx scripts/<name>.ts …` directly.

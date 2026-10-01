# JobPilot — backend + agent

Two things, and only two:

1. **Analyse a job advert** and watch the agent work — every step of the response is streamed and stored, so you can see what the model was asked, what it answered, what failed validation and what it cost.
2. **A job-hunt dashboard** — funnel, conversion rates, response times, which job boards actually convert, what is sitting without an answer.

Storage is **Cloudflare D1** (records) and **Cloudflare R2** (files: your CV, generated letters, advert snapshots). Both on the free plan. There is no frontend yet: this repo is the API and the agent.

## Layout

Everything under `src/` sits in a layer, and a layer only imports from the layers below it. The rule is
enforced by ESLint; the full picture, with diagrams and a "where does a change go" table, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```text
src/domain/      what a job, a run and a dashboard ARE: types, constants, zod schemas. No IO.
src/infra/       adapters to the outside world: db/ (D1, SQLite), storage/ (R2, local), llm/ (DeepSeek), search/, pdf/, env
src/data/        repositories and read models: job, run, file, resume, candidate profile, metrics, pipeline
src/agent/       the agent: core/ (trace, tool contract), tools/, prompts/, steps/ (identify, extract, letter), main-agent
src/services/    one function per use case, shared by the API and the CLI: analyseJob, getHealth
src/server/      HTTP glue for route handlers: read a body or query against a schema, map errors to statuses
src/app/         Next.js: api/ route handlers and the two pages
src/components/  React components (client code, domain types only)
src/cli/         terminal presentation: arguments, the live step printer, trace files
scripts/         the npm-run entry points, thin
db/migrations    SQL schema (applied by npm run db:migrate or wrangler)
tests/           vitest suite by layer, runs against an in-memory database
archive/ui-v0    the first UI attempt, parked for reference
```

## Setup

```bash
npm install
cp .env.example .env
```

### 1. The agent

Put a DeepSeek key in `.env`, then confirm the model id is one your key can call:

```bash
npm run check:model
```

With no key the agent still runs in **demo mode**: a deterministic local parser, same steps, same trace, no network.

### 2. Cloudflare D1 (free plan)

Create an API token at <https://dash.cloudflare.com/profile/api-tokens> → Create Token → Custom token → Permissions: **Account → D1 → Edit**. Put it in `.env` as `CLOUDFLARE_API_TOKEN`, then:

```bash
npm run d1:setup      # finds your account, creates the "jobpilot" database, fills .env
npm run db:migrate    # applies db/migrations
```

`d1:setup` writes `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` and `JOB_DB=d1` into `.env` and fills in `wrangler.toml`.

To work offline, set `JOB_DB=local` and the same SQL runs against `data/jobpilot.db` through `node:sqlite`.

### 3. Cloudflare R2 (free plan)

R2 needs its own S3 key pair, separate from the account API token: dashboard → R2 → API → **Manage API tokens** → Create API token → Object Read & Write. Put the pair in `.env` as `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, then:

```bash
npm run r2:setup      # creates the bucket, round-trips a test object, sets FILE_STORAGE=r2
```

Free tier: 10 GB stored, 1M writes and 10M reads a month, and no charge for downloads. Set `FILE_STORAGE=local` to keep files in `data/files` instead.

## Using it without a frontend

```bash
npm run agent:clip                                       # the whole flow on a pasted advert
npm run agent:save                                       # and track it in the database
npm run extract:clip                                     # sub-agent 1 alone, no database
npm run extract:schema                                   # its output contract
npm run cv:list                                          # resumes the agent can see
node --import tsx scripts/cover-letter.ts --file ad.txt --out letter.pdf
node --import tsx scripts/cv-add.ts --file cv.pdf --note "QA automation roles"
npm run metrics                                          # the dashboard, printed
npm run db:migrate                                       # apply db/migrations
npm run dev                                              # serve the API on :3000
```

### Passing arguments in PowerShell

PowerShell swallows the bare `--` separator, so `npm run x -- --flag` arrives at npm instead of the
script. Either quote the separator, or skip npm and call the script directly:

```powershell
npm run agent:extract "--" "--file" "data\sample-job.txt"   # quoted separator
node --import tsx scripts/extract.ts --file data/sample-job.txt   # or just run it
```

Argument-free shortcuts (`npm run extract:clip`, `npm run extract:schema`) sidestep the problem.

## API

| Method | Route | What it does |
| --- | --- | --- |
| POST | `/api/analyse-job` | Analyse an advert, return the result plus the full step trace |
| POST | `/api/analyse-job/stream` | Same, as server-sent events: `run.start`, `step.start`, `step.delta`, `step.end`, `run.end`, `result` |
| GET | `/api/jobs` | List applications. Filters: `status`, `source`, `company`, `search`, `activeOnly`, `limit`, `offset` |
| POST | `/api/jobs` | Track an analysed job |
| GET | `/api/jobs/:jobId` | One application with its status history |
| PATCH | `/api/jobs/:jobId` | Change status (with a note), notes, cover letter, source URL, location |
| DELETE | `/api/jobs/:jobId` | Remove an application and its history |
| GET | `/api/metrics` | Dashboard numbers. `?windowDays=90` to limit the period |
| GET | `/api/runs` | Agent run history |
| GET | `/api/runs/:runId` | One run with every step — the replay of the live stream |
| GET | `/api/files` | List files. Filters: `jobId`, `kind` (`cv`, `cover-letter`, `job-ad`, `attachment`) |
| POST | `/api/files` | Upload `multipart/form-data`: `file`, plus optional `kind`, `jobId`, `note` |
| GET | `/api/files/:fileId` | Metadata, `?download=1` for the bytes, `?url=1` for a signed R2 link |
| DELETE | `/api/files/:fileId` | Remove the object and its row |
| GET | `/api/health` | Database and storage reachable, which drivers, which model |

Request body for both analyse routes:

```json
{ "jobPost": "the full advert text", "save": false, "coverLetter": true }
```

## How the agents work

**Main agent** supervises. It decides whether the input is a job advert at all, runs the two
sub-agents, checks what they produce, and retries with the specific problem rather than looping
blindly. Three attempts maximum.

```text
[1] (main)         Is this a job advertisement?      stops here if it is not
[2] (extractor)    Read the advert, return JSON       sub-agent 1
[3] (extractor)    Check the JSON against the schema  {json_validator}
[4] (extractor)    Repair                             skipped when the first answer validates
[5] (extractor)    Find the company's own website     {company_website}
[6] (main)         Check the extracted record         required fields must not be null
[7] (cover-letter) Read the resumes in storage        sub-agent 2, {pdf_text} per CV
[8] (cover-letter) Pick the resume that fits          with a comparative reason
[9] (cover-letter) Write the letter                   two sections; the third is templated
[10](cover-letter) Render a one-page PDF              {build_pdf}
[11](cover-letter) Save to storage                    {storage_put}
[12](main)         Check the letter before it goes out
[13](main)         Save the application
```

**Step 1** is a model decision, not a keyword list. DeepSeek says whether the text is a job advertisement,
why, and what it looks like instead when it is not (company profile, news article, CV, email). A "no" stops
the run with that reason. An unreadable answer, or no API key, lets the advert through.

**Step 6** is the final check: `sCompany`, `sJobTitle`, `sJobSummary`, `sJobRequirement`,
`sContractType` and `sSource` must all carry a value. A null sends the advert back to sub-agent 1
naming the field that was empty. `sLocation` and `sTechStack` are reported as thin, not fatal.

**Tools**: `json_validator` (schema plus missing/null fields), `company_website` (the model
answers, a fetch verifies), `pdf_text` (reads your CVs), `build_pdf` (renders the letter),
`storage_put` (R2 plus the database row), `db_sql` (tracker CRUD, SELECT only for raw queries).

## Cover letters

Sub-agent 2 reads every resume in the bucket under `resume/`, picks the one that fits the advert,
and writes to your template: a right-aligned header, `Dear Recruitment Team,` and three sections.

- **Introduction** — your background, then why this role. A sentence about the company only when
  there is a verified fact about it.
- **Why I Am a Good Fit** — three or four sentences. Each one names something the advert asks for
  and the specific thing you have done that proves it. It is not a resume summary.
- **Additional Information** — assembled from `data/candidate.json`, never written by the model, so
  the visa date, residence sentence and notice period are identical every time.

Two files control it: `data/candidate.json` (name, contact, visa, notice, sign-off) and
`data/highlights.md` (background and achievements the letter may draw on beyond the resume).

The PDF goes to `Company-Name/Company-Name_Role.pdf` in R2, and that key is what
`Job.sCoverLetterPath` stores.

## Dashboard numbers

The funnel reads `status_history`, not the current status, so a job rejected after a final interview still counts as an interview. `npm run metrics` prints:

- totals: tracked, applied, active, interviewing, offers, rejected, waiting on a reply
- rates: response, interview, offer, rejection, average and median days to first response
- funnel with stage-to-stage conversion
- applications and responses per week
- conversion by source (SEEK vs LinkedIn vs direct)
- tech that keeps appearing in the adverts you chase
- applications sitting without an answer, oldest first
- agent cost: runs, failures, repair rate, tokens

## Before using it for real applications

Replace `data/cv.md` and `data/cover-letter-template.md` with your own content. The prompts forbid inventing experience, so anything not in `cv.md` will not appear in a letter.

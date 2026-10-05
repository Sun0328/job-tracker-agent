# Architecture

Everything under `src/` sits in one of six layers. A layer may import from the layers below it and never
from the ones above. The rule is enforced by ESLint (`import/no-restricted-paths` in `eslint.config.mjs`),
so `npm run lint` fails on a crossing, not a code review.

```mermaid
flowchart TB
    subgraph entry [Entry points]
        app["src/app<br/>Next.js routes and pages"]
        cli["scripts/ + src/cli<br/>terminal commands"]
    end
    server["src/server<br/>HTTP glue: parse body, map errors"]
    services["src/services<br/>use cases: analyseJob, getHealth"]
    agent["src/agent<br/>the agent: trace, tools, prompts, steps, orchestrator"]
    data["src/data<br/>repositories and read models over the database and the bucket"]
    infra["src/infra<br/>adapters: D1/SQLite, R2/local files, DeepSeek, search, PDF, env"]
    domain["src/domain<br/>types, constants, zod schemas. No IO."]
    components["src/components<br/>React, client-side"]

    app --> server --> services --> agent --> data --> infra --> domain
    app --> services
    app --> data
    app --> components --> domain
    cli --> services
    cli --> agent
    cli --> data
```

## The layers

| Layer | Folder | What lives here | May import |
| --- | --- | --- | --- |
| **domain** | `src/domain` | What a job, a run and a dashboard *are*: types, constants (`JOB_STATUSES`, `CONTRACT_TYPES`), and the zod schemas that validate a record. Nothing does IO. | nothing |
| **infra** | `src/infra` | Talking to the outside world, each behind a small interface: `db/` (D1 over HTTP, D1 through a Worker binding, local SQLite), `storage/` (R2 over S3, R2 through a Worker binding, local folder), `cloudflare.ts` (the Worker's bindings), `llm/` (DeepSeek chat), `search/` (web search providers), `pdf/` (read a CV, render a letter), `env.ts`. | domain |
| **data** | `src/data` | How records are stored and read: `job-repository`, `run-repository`, `file-repository`, `resume-repository` (with a pre-extracted text cache), `candidate-profile` (storage first, then `data/`), `demo-run-repository` (the demo's run limits), `window` (the dashboard date range), and the read models `metrics` and `pipeline`. | domain, infra |
| **agent** | `src/agent` | What the agent does. `core/` (the run trace, the tool contract, the trace factory), `tools/` (thin wrappers the steps call: `json_validator`, `company_website`, `build_pdf`, …), `prompts/` (what the models are asked), `steps/` (identify, extract, cover letter), `main-agent.ts` (the orchestrator). | domain, infra, data |
| **services** | `src/services` | One function per use case, shared by the API and the CLI so they cannot drift: `analyseJob` (with `prepareAnalysis`), `getHealth`, and `demo` (demo mode, its limits and messages). Request schemas live with the service that owns them. | domain, infra, data, agent |
| **server** | `src/server` | HTTP glue for route handlers: `http.ts` reads a JSON body or query against a schema and turns an error into a status; `demo.ts` identifies a demo visitor (cookie plus salted IP hash) and builds the demo refusals. | domain, services |
| **app** | `src/app` | Next.js: `api/` route handlers (thin controllers) and the two pages. | domain, data, services, server, components |
| **components** | `src/components` | React components. Client code, so it sees domain types only. | domain |
| **cli** | `src/cli` | Terminal presentation: argument parsing, the live step printer, the trace file writer. `scripts/*.ts` are the thin entry points `npm run` calls. | domain, infra, data, agent, services |

Outside `src/`: `scripts/` (entry points; `scripts/demo/` builds and ships the public demo, `scripts/e2e/` serves the browser tests, `scripts/ci/` holds CI checks), `tests/` (mirrors the layers), `e2e/` (Playwright browser tests), `db/migrations/` (schema), `demo/` (the demo's fictional inputs, seed and files), `data/` (local files, gitignored), `docs/`.

## Where does a change go?

| I want to… | Touch |
| --- | --- |
| Add a column to Job | `db/migrations/000N_*.sql`, `src/domain/job.ts`, `src/data/job-repository.ts` (columns + `rowToJob`) |
| Add an agent step | `src/agent/steps/<step>.ts`, wire it in `src/agent/main-agent.ts`, give it a name in `AgentName` (`src/domain/run.ts`) |
| Add a tool a step can call | `src/agent/tools/<tool>.ts` implementing `Tool`, export it from `src/agent/tools/index.ts`. The real work goes in `src/infra` or `src/data`; the tool only wraps it |
| Add a model or provider | `src/infra/llm/` or `src/infra/search/`. Nothing above infra should know a vendor's wire format |
| Add an API route | `src/app/api/.../route.ts` using `readJsonBody`/`readQuery`/`failure` from `src/server/http.ts`. Anything the CLI also needs goes in `src/services` first |
| Add a CLI command | `scripts/<name>.ts` + an npm script. Output through `src/cli/render.ts`; logic through `src/services` |
| Show something new on the dashboard | `src/data/metrics.ts` (query) → `src/domain/metrics.ts` (type) → `src/components` / `src/app/dashboard` |

## How a run flows through the layers

```mermaid
sequenceDiagram
    participant UI as app/api/agent/stream
    participant S as services.analyseJob
    participant M as agent/main-agent
    participant St as agent/steps
    participant T as agent/tools
    participant I as infra
    participant D as data

    UI->>S: request (validated by analyseRequestSchema)
    S->>M: runMainAgent(trace)
    M->>St: runIdentify
    St->>I: llm/deepseek.chat()
    M->>St: runJobExtractor → chat, json_validator, company_website
    St->>T: callTool(jsonValidator, companyWebsite)
    M->>D: createJob
    M->>St: runCoverLetterAgent → build_pdf, storage_put
    S-->>UI: serialiseAnalysis(result)
```

Every step is recorded by `RunTrace` (`src/agent/core/trace.ts`) and every tool call goes through
`callTool`, so the same trace feeds the SSE stream, the terminal printer and the archived run.

## The public demo

The same code runs as a public demo on Cloudflare Workers (free plan), with `DEMO_MODE=1` and only
fictional data. Your real setup is untouched: it keeps its own database and bucket, named in
`wrangler.real.toml`, and the demo Worker in `wrangler.jsonc` is bound only to `jobpilot-demo` and
`jobpilot-demo-files`.

```mermaid
flowchart LR
    subgraph repo [This repo]
        inputs["demo/<br/>profile, CV data, adverts, plan"]
        seed["demo/seed.sql + demo/bucket/"]
    end
    subgraph cf [Cloudflare, free plan]
        worker["Worker jobpilot-demo<br/>DEMO_MODE=1, no API tokens"]
        d1[("D1 jobpilot-demo")]
        r2[("R2 jobpilot-demo-files")]
    end
    inputs -- "npm run demo:data<br/>(real agent runs, local DB)" --> seed
    seed -- "npm run demo:reset<br/>(and nightly in GitHub Actions)" --> d1
    seed --> r2
    worker -- binding --> d1
    worker -- binding --> r2
```

What a visitor can do: one live AI analysis (one per visitor cookie, three per IP per day, a daily
cap for everyone), download the letter it wrote, and change any application's status. Everything
else that writes (deleting, uploading, editing fields) is refused with a "demo environment" message.

| Concern | Where |
| --- | --- |
| Is this the demo, how many runs, the messages | `src/services/demo.ts` |
| Who the visitor is | `src/server/demo.ts` (random id in an HttpOnly cookie, salted SHA-256 of the IP) |
| Taking and giving back a run | `prepareAnalysis` / `analyseJob` in `src/services/analyse-job.ts`, table `DemoRun` (`db/migrations/0006`) |
| The page's intro, example advert, toast | `src/components/demo.tsx`, `src/components/demo-example.ts`, `src/app/page.tsx` |
| The fictional candidate | `demo/profile/`, read by the Worker from `profile/` in its bucket |
| Building, resetting, running locally, deploying | `scripts/demo/build-data.ts`, `reset.ts`, `local.ts`, `deploy.ts` |

**How it deploys.** Cloudflare Workers Builds watches this repository and deploys every push to `master`
(build `npm run cf:build`, deploy `npx wrangler deploy`). The live demo is
<https://jobpilot-demo.fionasundev.workers.dev>. Runtime secrets (`DEEPSEEK_API_KEY`, `DEMO_SECRET`) live on
the Worker, set in the dashboard.

## The pipeline and its checks

GitHub Actions and Cloudflare each see the same push. Checks at each stage stop the next one.

```mermaid
flowchart TD
    push["git push"] --> ci["GitHub Actions: ci.yml<br/>typecheck, lint, unit tests (Node 22, 24),<br/>browser tests, Worker build + size + secrets,<br/>audit, history secret scan"]
    push --> codeql["codeql.yml<br/>static security analysis"]
    push --> wb["Cloudflare Workers Builds<br/>npm run cf:build"]
    wb --> gate{"typecheck, lint,<br/>unit tests pass?"}
    gate -- no --> stop["no deploy<br/>the live demo keeps the last version"]
    gate -- yes --> deploy["wrangler deploy<br/>new version live"]
    push --> verify["deploy-verify.yml<br/>wait for /api/health version = commit"]
    deploy -.-> verify
    verify --> smoke["smoke suite on the live demo<br/>(read-only)"]
    smoke -- fails --> rollback["roll back in the Cloudflare dashboard"]
```

| Stage | Checks | Code |
| --- | --- | --- |
| Static | `tsc`, ESLint (layer rules), actionlint | `ci.yml` job `static` |
| Unit and integration | 88 Vitest tests against in-memory SQLite: repositories, the demo limits, visitor identity, the whole agent run offline (`tests/services/analyse-offline.test.ts`), the demo seed's contract and privacy (`tests/data/demo-seed.test.ts`). Coverage floor on `src/{domain,data,services,agent,server}` | `tests/`, `vitest.config.ts` |
| Browser | Playwright on a production build (`scripts/e2e/serve.ts`: a fresh seeded copy of the demo, no model key). `smoke`: read-only, also run against the live site. `journey`: the HR visitor's path, local only | `e2e/`, `playwright.config.ts` |
| Worker | `opennextjs-cloudflare build`, size budget from `wrangler deploy --dry-run`, gitleaks over `.open-next` | `scripts/ci/worker-size.ts`, `.gitleaks.toml` |
| Security | `npm audit --omit=dev --audit-level=high`, gitleaks over the whole history, CodeQL `security-extended`, dependency review on pull requests | `ci.yml`, `codeql.yml` |
| Deploy gate | `npm run verify` inside the Cloudflare build | `package.json` `cf:build` |
| After deploy | `/api/health` `version` (the commit, inlined by `next.config.ts` from `WORKERS_CI_COMMIT_SHA`) must equal the pushed commit, then the smoke suite with `EXPECT_VERSION` | `deploy-verify.yml`, `e2e/global-setup.ts` |
| Daily | Smoke suite on the live site; after the nightly reset, `EXPECT_SEED=1` checks the demo holds exactly the seed | `deploy-verify.yml`, `demo-reset.yml` |

**Safety of the browser tests.** `e2e/global-setup.ts` runs before any test and refuses a target that is
not in demo mode. A local target must report the local database and storage drivers and no model key;
a remote one must be the Worker on its D1 and R2 bindings. The smoke suite changes nothing: it runs no
AI analysis, changes no status, and its refused writes use ids that do not exist.

**Why the manual deploy builds in a clean room.** The Cloudflare adapter reads every `.env` file in the
project at build time and embeds the values in the Worker, and Next.js copies `.env` into the server
bundle. `npm run demo:deploy` therefore builds in `data/demo/build`, a copy of the tracked files only,
then scans the output for every secret value in your `.env` and refuses to deploy if it finds one.
Never run `opennextjs-cloudflare build` or `deploy` in the project folder.

**Why the CV text is pre-extracted.** The free plan allows 10 ms of CPU per request, and parsing a
PDF takes far more. The demo bucket carries `resume-text/<key>.json` beside each CV, and the resume
repository uses it whenever its size matches the PDF.

## Conventions

- Imports across folders use the `@/` alias (`@/domain`, `@/infra/db`); only siblings inside one folder use `./`.
- `@/domain` is a barrel of types and constants. The zod schemas are imported explicitly from `@/domain/schemas`.
- Field names follow the database: `s` string, `b` boolean, `i` integer, `f` float, `dt` datetime, `o` object, `a` array.
- Tests live under `tests/<layer>/` and import through the same `@/` alias; `tests/helpers.ts` builds an in-memory database. Browser tests live under `e2e/smoke/` (read-only) and `e2e/journey/` (writes, local only).

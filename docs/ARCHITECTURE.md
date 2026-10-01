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
| **infra** | `src/infra` | Talking to the outside world, each behind a small interface: `db/` (D1 over HTTP, local SQLite), `storage/` (R2, local folder), `llm/` (DeepSeek chat), `search/` (web search providers), `pdf/` (read a CV, render a letter), `env.ts`. | domain |
| **data** | `src/data` | How records are stored and read: `job-repository`, `run-repository`, `file-repository`, `resume-repository`, `candidate-profile`, and the read models `metrics` and `pipeline`. | domain, infra |
| **agent** | `src/agent` | What the agent does. `core/` (the run trace, the tool contract, the trace factory), `tools/` (thin wrappers the steps call: `json_validator`, `company_website`, `build_pdf`, …), `prompts/` (what the models are asked), `steps/` (identify, extract, cover letter), `main-agent.ts` (the orchestrator). | domain, infra, data |
| **services** | `src/services` | One function per use case, shared by the API and the CLI so they cannot drift: `analyseJob`, `getHealth`. Request schemas live with the service that owns them. | domain, infra, data, agent |
| **server** | `src/server` | HTTP glue for route handlers: read a JSON body or query against a schema, turn an error into a status. | domain, services |
| **app** | `src/app` | Next.js: `api/` route handlers (thin controllers) and the two pages. | domain, data, services, server, components |
| **components** | `src/components` | React components. Client code, so it sees domain types only. | domain |
| **cli** | `src/cli` | Terminal presentation: argument parsing, the live step printer, the trace file writer. `scripts/*.ts` are the thin entry points `npm run` calls. | domain, infra, data, agent, services |

Outside `src/`: `scripts/` (entry points), `tests/` (mirrors the layers), `db/migrations/` (schema), `data/` (local files, gitignored), `docs/`.

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

## Conventions

- Imports across folders use the `@/` alias (`@/domain`, `@/infra/db`); only siblings inside one folder use `./`.
- `@/domain` is a barrel of types and constants. The zod schemas are imported explicitly from `@/domain/schemas`.
- Field names follow the database: `s` string, `b` boolean, `i` integer, `f` float, `dt` datetime, `o` object, `a` array.
- Tests live under `tests/<layer>/` and import through the same `@/` alias; `tests/helpers.ts` builds an in-memory database.

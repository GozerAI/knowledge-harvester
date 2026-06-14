# Knowledge Harvester

[![GozerAI](https://img.shields.io/badge/GozerAI-ecosystem-5eead4?style=flat-square&labelColor=0b0e14)](https://github.com/GozerAI) [![License](https://img.shields.io/badge/license-AGPL--3.0-3b82f6?style=flat-square)](LICENSE) [![Node](https://img.shields.io/badge/node-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org) [![Pro & Enterprise](https://img.shields.io/badge/Pro%20%26%20Enterprise-gozerai.com-fbbf24?style=flat-square)](https://gozerai.com/pricing)


Knowledge Harvester is a knowledge-ops pipeline for collecting, normalizing, enriching, storing, and exploring automation workflows and related technical artifacts.

In its current form, this repository is not just a scraper. It is a combination of:

- a CLI pipeline runner
- a set of source-specific harvesters
- a Postgres/pgvector-backed artifact store
- an HTTP API for browsing and operating on harvested data
- a growing set of maintenance, graph, discovery, and autonomy utilities

## What The Tool Actually Does

Today the codebase supports these major workflows:

- Harvest workflows and artifacts from many sources, including n8n, GitHub, Reddit, Activepieces, Windmill, Temporal, Airflow, Prefect, Dagster, LangGraph, ComfyUI, Dify, Flowise, Pipedream, Argo, Luigi, Tekton, GitHub Actions, Home Assistant, MLflow, dbt, Camunda, Kafka Connect, Camel, Terraform, Helm, Docker Compose, Kubernetes manifests, Ansible, CI configs, Dockerfiles, Jupyter notebooks, shell scripts, Makefiles, and YAML-defined GitHub searches.
- Normalize data into seven artifact families: `workflow`, `code_pattern`, `infra_config`, `ai_ml_asset`, `api_spec`, `data_asset`, and `documentation`.
- Run post-harvest enrichment such as classification, scoring, embeddings, packaging, guide generation, license detection, validation, test detection, trend enrichment, semantic deduplication, decay scoring, and understanding extraction.
- Build graph and discovery features such as recommendations, relations, clusters, bridge nodes, snapshots, coverage reports, and graph materialization.
- Expose the stored data and internal operations through a lightweight API for artifacts, collections, reviews, forks, analytics, webhooks, graphs, schedules, snapshots, discovery, feed/event streams, auto-refresh, and autonomy status.

## What This Is Not

- It is a self-hostable pipeline, not a hosted SaaS.
- It is not a generic SDK.
- It is not safe to assume `npm start` merely launches a server.

Run it as a self-hosted service to build and operate your own harvested knowledge base.

## Entry Points

There are two primary runtime modes.

### 1. CLI pipeline and operators

The CLI lives in [`src/index.js`](src/index.js).

Important behavior:

- `npm start` runs `node src/index.js`
- if no command is provided, the CLI defaults to `pipeline`
- that default pipeline is the full 23-step workflow, not a lightweight no-op

If you want a safe first command, start with one of:

```bash
node src/index.js stats
node src/index.js harvest --source n8n-community
node src/index.js classify --limit 20
```

### 2. Internal HTTP API

The API server lives in [`src/server.js`](src/server.js).

There is currently no dedicated npm script for it. Start it directly:

```bash
node src/server.js
```

By default it listens on `PORT=8011`.

The API is intended for internal use. In development, API auth is permissive if `KH_API_KEY` is unset. In production mode, requests to `/api/*` require `x-api-key` and the server returns `503` if `KH_API_KEY` is not configured.

## Current CLI Capability Surface

The CLI currently exposes these command groups:

- Ingestion: `harvest`, `migrate`
- Core enrichment: `classify`, `score`, `embed`, `package`, `guide`
- Analysis: `migrations`, `complexity`, `compose`, `facets`, `stats`
- Artifact quality and search: `license`, `validate`, `test-detect`, `freshness`, `relations`, `recommend`, `enrich-trends`
- Higher-order artifact operations: `dedup-semantic`, `decay`, `understand`, `graph-materialize`
- Operational and autonomy utilities: `schedule`, `snapshot`, `discover`, `coverage`, `compare`, `auto-refresh`, `sync-trends`, `pulse`
- End-to-end orchestration: `pipeline`

The full pipeline currently runs 23 steps:

1. migrate
2. harvest
3. classify
4. score
5. embed
6. package
7. guide
8. complexity
9. migrations
10. compose
11. monetize
12. bundle
13. license detection
14. validation
15. test detection
16. relation building
17. facet refresh
18. trend enrichment
19. semantic dedup
20. decay prediction
21. understanding extraction
22. claim extraction
23. graph materialization

## Current API Capability Surface

The API is broader than the old README implied. Current route families include:

- Health and metrics: `/health`, `/health/detailed`, `/metrics`
- Legacy workflow views: `/api/workflows`, `/api/categories`, `/api/stats`
- Harvest control and status: `/api/harvest`, `/api/harvest/:runId/status`
- Artifact CRUD and batch operations: `/api/artifacts`, `/api/artifacts/batch`, `/api/artifacts/batch/export`
- Artifact subresources: partial fetches, semantic search, at-risk listing, recommendations, export, scaffold, deploy manifest, reviews, forks, duplicates, canonical selection
- Marketplace-style views: packages, guides, bundles, trending artifacts
- Social and curation features: contributors, collections, reviews, forks
- Webhooks and GitHub webhook ingestion
- Graph and research endpoints: graph query/upsert, blueprints, research gaps
- Sourcing request orchestration: `/api/sourcing/requests`, `/api/sourcing/requests/:id`, `/api/sourcing/requests/:id/dispatch`
- Operational APIs: events, feed, schedules, snapshots, discovery, coverage, time compare, auto-refresh, Trendscope sync
- Autonomy dashboard endpoints: `/api/autonomy/pulse`, `/api/autonomy/timeline`

This is an internal backend, not just a harvest trigger.

## Defined Sourcing Contract

The harvester now exposes a defined sourcing-request layer so other internal systems, including orchestration layers, can ask for targeted research instead of directly guessing which harvesters to run.

This is the intended contract:

- An orchestrator or another caller submits a sourcing request with a requester, role, domain, topic, and objective.
- Knowledge Harvester qualifies that request against its current source catalog and existing artifact coverage.
- The request stores recommended sources, unsupported requested sources, suggested categories, suggested artifact types, and current coverage.
- The caller can review the request first or dispatch it immediately.
- The resulting harvest runs are recorded and linked back to the sourcing request.

Current role-aware planning supports requests from roles such as `cro`, `cpo`, `cmo`, `cfo`, `clo`, `chro`, and `coo`. Those roles influence which YAML and built-in sources are recommended for a request.

Example request payload:

```json
{
  "requester": "orchestrator",
  "requester_role": "cro",
  "domain": "revenue",
  "topic": "enterprise lead routing and sales handoff",
  "objective": "collect reusable guidance, workflows, policies, and enablement materials for revenue operations research",
  "research_questions": [
    "What artifacts describe lead qualification and routing?",
    "What sources cover sales handoff, onboarding, and customer-success transitions?"
  ],
  "preferred_sources": [
    "sales-playbooks",
    "sales-enablement",
    "customer-success-playbooks"
  ],
  "auto_dispatch": true
}
```

Primary endpoints:

- `POST /api/sourcing/requests` creates and qualifies a sourcing request
- `GET /api/sourcing/requests` lists sourcing requests
- `GET /api/sourcing/requests/:id` returns one sourcing request with qualification data
- `POST /api/sourcing/requests/:id/dispatch` dispatches the recommended or selected sources

The response qualification object is where callers should look for the harvester's judgment about fit and coverage. It includes:

- `recommended_sources`
- `unsupported_requested_sources`
- `suggested_categories`
- `suggested_artifact_types`
- `current_coverage`
- `recommendation`

## Data Model

The repository currently straddles two storage models:

- a legacy `workflows` table and related workflow-specific processing
- a more general `artifacts` table for the broader artifact taxonomy

That split explains why some commands and API endpoints are workflow-oriented while others are artifact-oriented.

## Artifact Types

Current artifact families:

| Type | Description |
|------|-------------|
| `workflow` | Automation workflows, DAGs, orchestration definitions |
| `code_pattern` | Reusable code snippets, components, handlers, templates |
| `infra_config` | Terraform, Helm, K8s, Docker, CI, shell, Make-style infra and ops config |
| `ai_ml_asset` | Notebooks, training configs, model-adjacent artifacts |
| `api_spec` | OpenAPI, GraphQL, and related API contract artifacts |
| `data_asset` | SQL schemas, dbt-style assets, migrations, data definitions |
| `documentation` | ADRs, runbooks, operational and technical docs |

## Source Coverage

The CLI currently advertises 37+ built-in sources, plus YAML-defined sources loaded from [`src/definitions`](src/definitions).

The built-in source categories are:

- workflow/template/community sources
- code-search-driven workflow sources
- infrastructure/config harvesters
- notebook/script/config pattern harvesters
- YAML-defined GitHub code-search harvesters

Current YAML definitions in this repo:

- `fastapi-patterns`
- `pytorch-training`
- `react-patterns`
- `openapi-specs`
- `asyncapi-specs`
- `grpc-protos`
- `graphql-schemas`
- `sql-schemas`
- `adrs`
- `runbooks`
- `security-policies`
- `compliance-controls`
- `support-playbooks`
- `product-requirements`
- `release-checklists`
- `vendor-assessments`
- `legal-contracts`
- `finance-controls`
- `employee-handbooks`
- `privacy-governance`
- `board-governance`
- `sales-playbooks`
- `sales-enablement`
- `customer-onboarding`
- `customer-success-playbooks`
- `hr-onboarding`
- `incident-postmortems`
- `mcp-servers`
- `open-policy-agent`
- `aws-step-functions`
- `google-workflows`
- `kestra-flows`
- `flyte-workflows`
- `pulumi-programs`
- `cloudformation-templates`

## Source Expansion Process

Future domain and source growth should follow a fixed repo process, not ad hoc additions.

Use [`docs/source-domain-expansion-process.md`](docs/source-domain-expansion-process.md) as the source of truth for:

- when to add a new source versus a new domain
- how to qualify legitimacy, fit, and discard rules
- how to check existing coverage before expanding
- how to keep bias and overrepresentation in check
- what implementation and verification steps are required

Supporting templates live here:

- [`docs/templates/domain-source-proposal.md`](docs/templates/domain-source-proposal.md)
- [`docs/templates/source-definition.yaml.example`](docs/templates/source-definition.yaml.example)

Important detail: YAML source names are the definition names above. They are invoked like this:

```bash
node src/index.js harvest --source fastapi-patterns
node src/index.js harvest --source react-patterns
```

The old `yaml-fastapi-patterns` style examples were wrong.

## Setup

### Requirements

- Node.js 18+
- Docker, if you want the bundled Postgres + pgvector setup
- Ollama, for classification, scoring, embeddings, and several downstream enrichment steps
- GitHub token, if you want most GitHub-backed harvesters and all YAML-defined harvesters to do useful work

### Basic local setup

```bash
git clone https://github.com/GozerAI/knowledge-harvester.git
cd knowledge-harvester
npm install
cp .env.example .env
docker compose up -d
npm run migrate
```

### Safer first-run commands

Instead of immediately running the full pipeline, start with:

```bash
node src/index.js stats
node src/index.js harvest --source n8n-community
node src/index.js harvest --source fastapi-patterns
```

Only run this once the environment is ready:

```bash
npm run pipeline
```

## Running The API

Start the server directly:

```bash
node src/server.js
```

Useful environment variables for the API:

- `PORT` - server port, defaults to `8011`
- `KH_API_KEY` - required for `/api/*` in production mode
- `KH_RATE_LIMIT` - per-IP rate limit for `/api/*`, defaults to `60` requests per minute
- `KH_WEBHOOK_SECRET` - webhook dispatch signing secret
- `TRENDSCOPE_WEBHOOK_URL` - optional outbound webhook target

Useful endpoints to verify the service:

```text
GET /health
GET /health/detailed
GET /metrics
GET /api/stats
GET /api/artifacts
GET /api/autonomy/pulse
```

## Configuration

Key runtime configuration comes from `.env`, `src/config.js`, and a few server-only environment variables.

### Database and model settings

| Variable | Default in code | Notes |
|----------|------------------|-------|
| `PG_HOST` | `localhost` | Postgres host |
| `PG_PORT` | `5432` | Code fallback; `.env.example` and Docker Compose use `5435` on the host |
| `PG_DATABASE` | `workflow_library` | Database name |
| `PG_USER` | `harvester` | Database user |
| `PG_PASSWORD` | empty string | `.env.example` provides a local dev password |
| `GITHUB_TOKEN` | empty | Needed for most GitHub-backed harvesters and YAML-defined searches |
| `REDDIT_CLIENT_ID` | empty | Optional |
| `REDDIT_CLIENT_SECRET` | empty | Optional |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Used for generation/classification-style tasks |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Used for embeddings |
| `TRENDSCOPE_BASE_URL` | `http://localhost:8009` | Optional integration target |

### Port note

There is one subtle but important mismatch in the current runtime setup:

- application code defaults `PG_PORT` to `5432`
- `.env.example` sets `PG_PORT=5435`
- Docker Compose maps host `5435` to container `5432`

In practice, local setup works if you copy `.env.example`. If you rely on code defaults alone, the app expects a local Postgres instance on `5432`.

## Architecture Reality Check

The old README described a simpler project than the codebase now contains.

More accurate framing:

- the CLI is the orchestration layer
- harvesters are only one part of the system
- the repo now includes graph, quality, packaging, monetization, maintenance, and autonomy-style capabilities
- the internal API is substantial enough to treat as a first-class subsystem
- the project still contains legacy workflow-specific paths alongside the generalized artifact model

## Practical Usage Examples

Harvest one source:

```bash
node src/index.js harvest --source n8n-community
```

Harvest a YAML-defined artifact family:

```bash
node src/index.js harvest --source openapi-specs
```

Run selected enrichment steps:

```bash
node src/index.js classify --limit 50
node src/index.js score --limit 100
node src/index.js embed --limit 100
node src/index.js relations --limit 200
```

Inspect the knowledge base:

```bash
node src/index.js stats
node src/index.js coverage
node src/index.js snapshot list
node src/index.js pulse
```

Run the internal API:

```bash
node src/server.js
```

Create a sourcing request for targeted research:

```bash
curl -X POST http://localhost:8011/api/sourcing/requests \
  -H "Content-Type: application/json" \
  -d '{
    "requester": "orchestrator",
    "requester_role": "cpo",
    "domain": "product",
    "topic": "onboarding and release readiness",
    "objective": "find source material for product operations research",
    "preferred_sources": ["product-requirements", "release-checklists"],
    "auto_dispatch": false
  }'
```

## Testing

Run the full suite:

```bash
npm test
```

## License

MIT. See [LICENSE](LICENSE).

# Tech Stack — Corgi (Hangout Planner Agent)

This is the single source of truth for what we build with. It expands and, in one place, **deliberately deviates from** `design-doc.md` §10 — see the callout below. If you disagree with a choice here, raise it in a PR against this file with rationale; don't silently build something different.

Every agent (human or AI) working in this repo must read this file before writing code that touches infrastructure, adds a dependency, or picks a library.

---

## ⚠️ Deviation from design-doc.md: one language, not two

`design-doc.md` §10 suggests a Python backend (Flask/FastAPI). But the Photon/Spectrum SDK (`spectrum-ts`) is **TypeScript/Node-only** — there is no first-party Python SDK. Splitting the system into a Node transport sidecar + a Python reasoning backend adds a cross-process boundary, a second dependency graph, and a second test/lint/CI setup, for no real benefit in a hackathon-scoped, multi-agent codebase.

**Decision: the entire backend is TypeScript on Node.js.** Anthropic has a first-party TypeScript client. Merge Agent Handler's management SDKs are still in development, but its management REST API works with any TypeScript HTTP client and its tool runtime is MCP. Nothing is lost by dropping Python. If someone already has a working Python service before reading this, flag it in a PR — don't just merge a second stack in quietly.

---

## Language & Runtime

- **TypeScript**, `strict: true` in `tsconfig.json` (no `any` without a `// justified:` comment explaining why it can't be typed).
- **Node.js**, current Active LTS at project start. Pin the exact version in `.nvmrc` and `package.json#engines` the day the repo is bootstrapped — do not guess a version number from memory, check [nodejs.org](https://nodejs.org) for the current LTS.
- **Package manager: pnpm**, lockfile (`pnpm-lock.yaml`) committed and never hand-edited. One lockfile, one source of truth for every transitive dependency — this is what stops five different agents from each resolving slightly different dependency trees.

## Web / API Framework

- **Fastify** for the HTTP server (webhook ingestion endpoint, card-interaction endpoint, any internal admin routes).
- Use `fastify-type-provider-zod` (or equivalent) so every route's request/response shape is a Zod schema, not an untyped object. This is a direct defense against the #1 AI-code failure mode found in research for this project: missing input validation at trust boundaries.

## Transport — Photon / Spectrum SDK

- Library: `spectrum-ts` (Photon).
- **Before building the ingestion layer, verify against the live Photon docs (photon.codes) whether webhook mode or the gRPC-stream/Node-sidecar mode is current and recommended.** Spectrum's integration pattern has changed rapidly; `design-doc.md` §4 assumes webhook delivery, but treat that as a hypothesis to confirm on day one, not a fact to build blindly on. This is exactly the kind of "hallucinated API shape" risk the [Agent Rules](./AGENTS.md) file warns about — don't let an agent invent Spectrum call signatures from training data. Read the actual current SDK types.
- Whichever mode is current, isolate it behind a small internal interface (e.g. `TransportPort` with `onMessage`, `onCardInteraction`, `sendMessage`, `updateCard`) so the rest of the codebase never imports `spectrum-ts` directly. If Photon changes their API again mid-project, one file changes, not twenty.

## Reasoning — Claude

- SDK: `@anthropic-ai/sdk` (TypeScript).
- Model assignment (cost/latency matched to each call site per `design-doc.md` §7's own cost-consciousness):
  - **`claude-haiku-4-5-20251001`** for the "should I speak now" classifier (§7) — cheap, frequent, low-latency by design.
  - **`claude-sonnet-5`** for context extraction (§6), plan synthesis (§8), and feedback-diff (§9) — these need real reasoning quality.
- Define these two model IDs in exactly **one** config module (e.g. `src/claude/models.ts`). No agent hardcodes a model string inline anywhere else — this is how a team ends up quietly running three different models in production without noticing.
- All structured Claude outputs (profile JSON, plan object, diff patch) must be requested via forced tool-use / JSON-schema output, **and** re-validated with Zod on receipt. Never trust that the model returned well-formed JSON just because you asked for it — this is the single highest-value defense against a hallucinated/malformed response silently corrupting the Plan Object Store.

## Tool / Data Layer — Merge Agent Handler

**P4-1 result (verified 2026-07-25 against live official docs):**

- Agent Handler has two separate surfaces. Its [REST API](https://docs.merge.dev/merge-agent-handler/agent-handler) is the management plane for Registered Users, Tool Packs, Link tokens, and account configuration; official management SDKs are still in development, so call REST with a normal TypeScript HTTP client. Corgi's runtime discovers and calls tools through Merge's [MCP integration](https://docs.merge.dev/merge-agent-handler/build/connecting-agents/mcp-integration). Do not invent a direct tool-registration API.
- For built-in Connectors, create a Tool Pack with [`POST /api/v1/tool-packs/`](https://docs.merge.dev/merge-agent-handler/agent-handler/tool-packs/tool-packs-create) and `{ name, description, connectors: [{ slug, auth_scope, tool_names }] }`, selecting only the tools Corgi needs. Corgi must use `auth_scope: "INDIVIDUAL"` for personal Google/Outlook calendars.
- Live venue and event discovery uses [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search) behind Corgi's normalized `search_venues` and `search_events` tools. Use native `fetch`, `search_depth: "basic"`, and `auto_parameters: false`; this keeps each request to one credit on Tavily's [free 1,000-credit monthly plan](https://docs.tavily.com/documentation/api-credits). Preserve validated ranked web evidence rather than fabricating structured prices, addresses, or event times that Tavily did not return. The seeded P1-4 data remains the deterministic demo fallback.
- To expose Corgi's Tavily-backed tools through Agent Handler, operate a [custom MCP Connector](https://docs.merge.dev/merge-agent-handler/build/connecting-agents/custom-mcp-servers). The documented registration flow is dashboard **Connectors → Add new** with a unique name, remote publicly reachable HTTPS MCP endpoint, and static bearer token/API key; Merge then runs `tools/list`. Add the discovered Connector to Corgi's Tool Pack and select `search_venues` and `search_events`, or the runtime MCP endpoint will not expose them. There is no documented custom-Connector create endpoint to implement, and local/stdio servers are unsupported.
- A [Registered User](https://docs.merge.dev/merge-agent-handler/build/users/registered-users) is the per-end-user isolation boundary for credentials and tool calls. Create one idempotently from a stable, opaque, person-scoped `origin_user_id`; Zod-validate the live P0-2 sandbox response because Merge's prose guide and endpoint reference currently disagree on the identifier field name. Persist the validated Agent Handler Registered User identifier on a global `MergeIdentity` keyed to that person, so one calendar connection can be reused when the same person joins another group. Every lookup must still authorize through the current `GroupMember`, and calendar observations, profiles, transcripts, and plans remain group-scoped. A configured test ID is only for sandbox smoke tests.
- Use the official [`@modelcontextprotocol/sdk` TypeScript client](https://ts.sdk.modelcontextprotocol.io/client.html): `Client` with `StreamableHTTPClientTransport`, not `StdioClientTransport`. Connect to `https://ah-api.merge.dev/api/v1/tool-packs/<TOOL_PACK_ID>/registered-users/<REGISTERED_USER_ID>/mcp` with `Authorization: Bearer <ACCESS_KEY>`.
- Call the per-person [`tools/list` endpoint](https://docs.merge.dev/merge-agent-handler/agent-handler/mcp/endpoint-post) with `authenticated_only=true`, then use each live result's exact `name` and `inputSchema`; never construct or guess Merge runtime names or arguments. Keep Corgi's normalized wrappers stable as `search_venues`, `search_events`, and `calendar_availability`, mapping them to discovered tools internally.
- Calendar adapters are Connector-specific: Google Calendar exposes [`query_freebusy`](https://docs.merge.dev/merge-agent-handler/connectors/google-calendar); Outlook exposes [`get_user_schedule` and `find_meeting_times`](https://docs.merge.dev/merge-agent-handler/connectors/outlook). Normalize their different schemas. The Tools wrapper must load the authoritative current group-membership snapshot itself, carry its revision through personal-calendar calls for revalidation, cap fan-out, and never accept a caller-selected subset of members. If no authenticated calendar tool is discovered, explicitly use same-group chat-text availability inference. If a call returns [`reauth_required`](https://docs.merge.dev/merge-agent-handler/resources/troubleshooting), surface an explicit reconnect-required signal and continue planning with chat-text inference rather than failing or silently treating the credential as absent.
- Every wrapper still requires a typed request/response, Zod validation, an explicit timeout, and explicit error/fallback behavior.

## Storage

- **Prisma** as the ORM, backed by **SQLite** for local dev and the hackathon demo, with a schema written so a swap to **Postgres** (per `design-doc.md` §10, "if there's time") is a `DATABASE_URL` + `datasource` change, not a rewrite.
- Models: `Person`, `MergeIdentity`, `GroupProfile`, `PersonProfile`, `PlanObject` (versioned — see §8 of the design doc, keep a `version` column and never mutate a prior version in place), `TranscriptBuffer`, and `GroupMember`. `MergeIdentity` owns the nullable Agent Handler Registered User mapping required by P4-4 and is unique per `Person`; `GroupMember` remains the mandatory authorization boundary, and no learned profile or raw calendar data is shared across groups.
- All schema changes go through Prisma Migrate (`prisma migrate dev`), committed migration files — never hand-edit the SQLite file or ship a schema change without a migration.

## Validation

- **Zod** everywhere data crosses a boundary: incoming webhooks/gRPC payloads, Claude structured outputs, Merge tool responses, HTTP request/response bodies. If it came from outside this process, it gets parsed through a schema before touching business logic.

## Testing

- **Vitest** for unit and integration tests (Jest-compatible API, fast, native TS/ESM support).
- **Supertest** (or Fastify's built-in `.inject()`) for HTTP endpoint tests.
- **MSW** (Mock Service Worker) or `nock` to intercept outbound HTTP in tests — Claude, Merge, and Photon calls are mocked at the network boundary, not by hand-rolling fake client objects that drift from the real client's behavior.
- See [AGENTS.md](./AGENTS.md) for the actual testing _rules_ (what must be tested, how to avoid tautological tests). This file just names the tools.

## Lint / Format

- **ESLint** + `typescript-eslint` (strict config, not just `recommended`) + **Prettier**.
- Both run in CI and as a pre-commit hook (e.g. via `simple-git-hooks` or `husky` + `lint-staged`) so bad formatting/lint never even reaches a PR.

## CI/CD

- **GitHub Actions.** One required workflow, one command: `pnpm check` = typecheck + lint + test + build, all must pass.
- Branch protection on `main`: required status checks (`pnpm check`), at least one review/approval, no direct pushes. See [AGENTS.md](./AGENTS.md) for the full merge workflow.

## Environment & Secrets

- `dotenv` for local env loading. `.env` is git-ignored; `.env.example` is committed and kept up to date with every env var the app reads (placeholder values only).
- Secrets/config needed: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `MERGE_ACCESS_KEY`, `MERGE_TOOL_PACK_ID`, `MERGE_TEST_REGISTERED_USER_ID` (sandbox smoke tests only), `CORGI_MCP_CONNECTOR_TOKEN` (shared by Merge's custom Connector and Corgi's remote MCP server), and `PHOTON_API_KEY` / Spectrum credentials. Production Registered User IDs come from the persisted per-person mapping, never global config. Never commit real values, never log secret values, never put them in error messages.
- A secret-scanning pre-commit/CI check (e.g. `gitleaks`) is required — this is cheap insurance against the most embarrassing possible mistake.

## Repository Layout

```
/src
  /transport        # spectrum-ts integration, isolated behind TransportPort
  /orchestrator      # state machine driving proposed -> revising -> confirmed
  /context           # context extraction layer (design-doc §6)
  /synthesis         # plan synthesis layer (design-doc §8)
  /feedback          # feedback/diff layer (design-doc §9)
  /tools             # Merge Agent Handler tool wrappers (search_venues, search_events, calendar)
  /claude            # Claude client wrapper + models.ts (single source of model IDs)
  /store             # Prisma client + repositories (profiles, plan objects, transcript buffer)
  /types             # shared Zod schemas / TS types (Plan Object, Profile, etc.)
  /server.ts         # Fastify app entrypoint
/tests
  /unit
  /integration
  /fixtures          # seeded fake group chat + curated venue dataset (design-doc §10 "demo safety net")
/prisma
  schema.prisma
  /migrations
.github/workflows/ci.yml
.env.example
```

Any new top-level folder under `/src` should map to a section of the design doc. If your change doesn't fit an existing folder, that's worth a sentence in your PR description, not a silent new folder.

## Approved Dependencies / Adding New Ones

Everything above is the approved list. To add a new dependency:

1. Confirm it actually exists: check it on the npm registry, look at weekly download count, last publish date, and the GitHub repo. A package with near-zero downloads or no repo is a hallucination-adjacent red flag — do not install it on the strength of a model's confidence alone.
2. Pin an exact version (no bare `^`/`~` for anything security- or correctness-critical; pnpm's lockfile covers the rest).
3. Add it to this file in the same PR that introduces it, with a one-line reason. A dependency that shows up in `package.json` but not here is a review blocker.

- `@anthropic-ai/sdk@0.115.0` — official Anthropic TypeScript SDK used by the Claude client wrapper.

See [AGENTS.md](./AGENTS.md) for the full rule set this stack is designed to support.

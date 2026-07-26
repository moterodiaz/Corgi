# Tech Stack — Corgi (Hangout Planner Agent)

This is the single source of truth for what we build with. It expands and, in one place, **deliberately deviates from** `design-doc.md` §10 — see the callout below. If you disagree with a choice here, raise it in a PR against this file with rationale; don't silently build something different.

Every agent (human or AI) working in this repo must read this file before writing code that touches infrastructure, adds a dependency, or picks a library.

---

## ⚠️ Deviation from design-doc.md: one language, not two

`design-doc.md` §10 suggests a Python backend (Flask/FastAPI). But the Photon/Spectrum SDK (`spectrum-ts`) is **TypeScript/Node-only** — there is no first-party Python SDK. Splitting the system into a Node transport sidecar + a Python reasoning backend adds a cross-process boundary, a second dependency graph, and a second test/lint/CI setup, for no real benefit in a hackathon-scoped, multi-agent codebase.

**Decision: the entire backend is TypeScript on Node.js.** Anthropic and Merge both have first-class HTTP APIs (and Merge/Anthropic TS clients), so nothing is lost by dropping Python. If someone already has a working Python service before reading this, flag it in a PR — don't just merge a second stack in quietly.

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

- Use Merge's Agent Handler to register `search_venues`, `search_events`, and (if wired up) calendar-availability as agent tools, per `design-doc.md` §5.
- Consult `docs.merge.dev/merge-agent-handler` directly for the current tool-registration API rather than assuming a shape — same rule as Spectrum above.
- Wrap every Merge tool call in the same pattern as Claude calls: typed request, Zod-validated response, explicit timeout, explicit fallback (chat-text inference for availability, per §5, is the documented fallback — implement it as a real code path, not a TODO).

## Storage

- **Prisma** as the ORM, backed by **SQLite** for local dev and the hackathon demo, with a schema written so a swap to **Postgres** (per `design-doc.md` §10, "if there's time") is a `DATABASE_URL` + `datasource` change, not a rewrite.
- Models: `GroupProfile`, `PersonProfile`, `PlanObject` (versioned — see §8 of the design doc, keep a `version` column and never mutate a prior version in place), `TranscriptBuffer`.
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
- Secrets needed: `ANTHROPIC_API_KEY`, `MERGE_API_KEY` (+ any account token), `PHOTON_API_KEY` / Spectrum credentials. Never commit real values, never log secret values, never put them in error messages.
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

### E2 implementation dependencies

- `@anthropic-ai/sdk` `0.115.0` — Claude Messages API with forced tool use.
- `zod` `4.4.3` — validation of every structured Claude boundary and shared contracts.
- `nock` `14.0.16` — HTTP-boundary Claude client tests.

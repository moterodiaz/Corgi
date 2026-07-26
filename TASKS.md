# Build Plan — Corgi (Hangout Planner Agent)

Every bullet below is one unit of work for one person (or one agent): one branch, one PR, per the workflow in [AGENTS.md](./AGENTS.md). If every box here is checked, tested, and merged to `main`, the app in [design-doc.md](./design-doc.md) is done and demo-ready — that's the exit condition for this whole list, not for any single item.

**Definition of done for every task below** (don't repeat this per-bullet, it always applies — see [AGENTS.md](./AGENTS.md) for the full checklist):

- Real unit/integration tests written, including at least one failure/edge case, not just the happy path.
- `pnpm check` (typecheck + lint + test + build) passes locally before opening the PR.
- Any new dependency is added to [TECH_STACK.md](./TECH_STACK.md)'s approved list in the same PR.
- Any contract change (Plan Object shape, Prisma schema, `TransportPort`, tool interfaces) is flagged `[CONTRACT CHANGE]` in the PR.

**How to read the phases:** they're ordered by dependency — don't start a task whose dependencies aren't merged yet. Tasks _within_ a phase can generally be picked up in parallel by different people unless a task explicitly says it depends on another task in the same phase. Phase and task IDs (`P0-1`, etc.) are for referencing dependencies, not a required order within a phase.

**Explicitly out of scope** (`design-doc.md` §2) — do not add tasks for these, and flag it if a PR starts drifting toward one: cross-group/persistent learning, payment or booking execution, non-iMessage platforms (WhatsApp/Telegram) even though Spectrum supports them.

---

## Phase 0 — Decisions & Environment (blocks everything else)

- [ ] **P0-1. Decide the venue/event data source now, not later.** Real Merge-connected source (Yelp-like API, ticketing API, curated dataset the team owns) vs. a seeded static dataset for demo reliability, per `design-doc.md` §12's explicit "decide early" risk. This decision blocks P1-4 (fixtures) and all of Phase 4 (Merge tools).
- [ ] **P0-2. Acquire credentials/accounts:** Anthropic API key, Merge account + sandbox key, Photon/Spectrum account with a registered test iMessage number/bot. Confirm all three actually work with a trivial curl/SDK call each — don't assume a key is valid until it's been used once.
- [ ] **P0-3. GitHub repo settings (needs admin access):** branch protection on `main` — require the `pnpm check` status check, require at least one review, disallow force-push and direct commits.
- [ ] **P0-4. Project scaffolding:** `package.json`, `tsconfig.json` (`strict: true`), `.nvmrc` pinned to current Node Active LTS, `pnpm-lock.yaml` initialized, folder skeleton matching the layout in `TECH_STACK.md`.
- [ ] **P0-5. Tooling setup:** ESLint + `typescript-eslint` (strict, not just recommended) + Prettier; `husky`/`lint-staged` pre-commit hook; `gitleaks` (or equivalent) secret-scan hook.
- [ ] **P0-6. CI + app skeleton:** GitHub Actions workflow running `pnpm check` on every PR; a minimal Fastify app with a `/health` route and its test, and Vitest wired up so CI has a real thing to run (not a no-op). Configure the logger (pino, Fastify's default) to redact known secret env vars from output.
- [ ] **P0-7. `.env.example` + config module:** every secret from P0-2 listed with a placeholder value, loaded via `dotenv` into one typed config module the rest of the app imports — no direct `process.env` access scattered around.
- [ ] **P0-8. README.md:** clone → install → env setup → run locally → run tests, written so a new teammate (or fresh agent) doesn't have to reverse-engineer setup from `TECH_STACK.md`.

## Phase 1 — Shared Contracts & Data Layer

_Depends on Phase 0._

- [ ] **P1-1. Zod schemas** for `PlanObject` (matching the shape in `design-doc.md` §8 exactly, including `version` and `status` enum), `PersonProfile`, `GroupProfile`, `TranscriptEntry` in `/src/types`, with tests validating both good and malformed example payloads.
- [ ] **P1-2. Prisma schema:** `GroupProfile`, `PersonProfile`, `PlanObject` (versioned — a new version is a new row, never an in-place mutation of a prior one), `TranscriptBuffer`, plus the initial migration.
- [ ] **P1-3. Repository layer** (`/src/store`) wrapping Prisma: profile upsert/merge (confidence/recency-aware, per §6), plan-object version-bump-on-write, transcript append/read scoped per group. Unit tests per operation, including the "don't mutate a prior plan version" invariant.
- [ ] **P1-4. Seed fixtures** _(depends on P0-1)_: a fake group chat transcript that plays out the §11 demo narrative, plus the venue/event dataset chosen in P0-1, in `/tests/fixtures`. Fixtures validate against the P1-1 schemas as part of their own test.

## Phase 2 — Transport Layer (Photon / Spectrum)

_Depends on Phase 0. P2-1 and P2-2 block later items in this phase and in Phase 6 — do them first._

- [ ] **P2-1. Spike: confirm the current Spectrum integration mode** (webhook vs. gRPC/Node-sidecar) against the live Photon docs, not against what `design-doc.md` §4 assumed. Update `TECH_STACK.md`'s note on this once confirmed.
- [ ] **P2-2. Spike: verify mini-app card in-place update semantics** against a real sandbox/test account with a minimal throwaway script, per the `design-doc.md` §12 risk ("confirm before building the revision UX around it"). Don't let Phase 6 assume this works.
- [ ] **P2-3. Define `TransportPort`** (`onMessage`, `onCardInteraction`, `sendMessage`, `updateCard`) plus an in-memory mock implementation, with tests. Nothing outside this file should import `spectrum-ts` directly.
- [ ] **P2-4. Inbound adapter:** real `spectrum-ts` wiring for messages and card-interaction events, including verifying the event's signature/authenticity before processing it, and basic rate-limiting on the public endpoint. Tests against recorded/mocked payloads.
- [ ] **P2-5. Outbound adapter:** `sendMessage`, create/update mini-app card, and the poll-style component, via `spectrum-ts`. Tests.
- [ ] **P2-6. Rolling transcript buffer wiring:** every inbound message appended per-group via the P1-3 repository, tagged with sender — built with no assumption of backfilled history, per the §4 design note. Tests.

## Phase 3 — Claude Reasoning Layer

_Depends on Phase 1 (needs the schemas and repositories to read/write against)._

- [x] **P3-1. Anthropic client wrapper + `models.ts`** (Haiku 4.5 for the classifier, Sonnet 5 for extraction/synthesis/diff, per `TECH_STACK.md`) plus a generic "call with forced structured output, then Zod-validate the response" helper. Tests via mocked HTTP (MSW/nock) — including a test for what happens when the model returns malformed JSON.
- [ ] **P3-2. "Should I speak now" classifier** (§7): prompt + schema for silent/clarifying/propose, with tests covering every named signal in the design doc — explicit planning language, a lull, an unresolved disagreement, insufficient profile coverage — and asserting the default bias toward silence when signals are ambiguous.
- [ ] **P3-3. Context Extraction Layer** (§6): periodic trigger (every N messages or time-window, whichever comes first), prompt producing structured per-person and group-level deltas, confidence/recency-aware merge into the stored profile via P1-3. Tests, including a test that one mention is weaker signal than three (as the design doc specifies).
- [ ] **P3-4. Plan Synthesis Layer** (§8): prompt combining profiles + retrieved candidates (stub the retrieval call until Phase 4 lands) + current plan object → new versioned `PlanObject` + human-readable rationale. Tests including the versioning behavior on revision.
- [ ] **P3-5. Feedback/Diff Layer** (§9): diff-style prompt classifying feedback into hard-constraint-change / preference-nudge / full-reject, applying only the changed fields (never a full re-derivation) while preserving the learned profile on a full-reject. Explicit tests for each of the three feedback types.

## Phase 4 — Merge Agent Handler / Tools

_Depends on P0-1 (data source decision) and P0-2 (Merge credentials)._

- [ ] **P4-1. Spike: confirm the current Merge Agent Handler tool-registration API** against live docs at `docs.merge.dev`, not from memory.
- [ ] **P4-2. `search_venues` tool wrapper:** typed request/response, Zod-validated, explicit timeout, tests against the P0-1 data source.
- [ ] **P4-3. `search_events` tool wrapper:** same pattern, tests.
- [ ] **P4-4. Calendar availability tool wrapper** + the chat-text-inference fallback from §5 built as a real branch (not a TODO) for when no calendar is connected. Tests for both the connected and fallback paths.
- [ ] **P4-5. Wire real tool calls into Plan Synthesis** (replacing the P3-4 stub). Integration tests.

## Phase 5 — Orchestrator (State Machine)

_Depends on Phases 2, 3, and 4._

- [ ] **P5-1. Plan state machine:** `proposed → revising → confirmed → abandoned`, an explicit valid-transition table, tests that specifically assert invalid transitions are rejected.
- [ ] **P5-2. Wire the full inbound loop:** message in → transcript append (P2-6) → periodic context extraction (P3-3) → speak/silent classifier (P3-2) → branch to synthesis (P3-4) or diff (P3-5) → transport output (P2-5). One integration test driving this end-to-end against the mock `TransportPort` and mocked Claude/Merge.
- [ ] **P5-3. Transparency query handling** (§9): detect a direct "how do you know that?" / "what have you picked up on?" ask and answer plainly from the stored profile. Tests.
- [ ] **P5-4. Card-interaction routing:** 👍/👎/"suggest something else" from P2-4 routed directly into the Feedback/Diff Layer (P3-5) as structured signal, bypassing free-text NLU entirely. Tests.

## Phase 6 — Mini-App Card / Widget UX

_Depends on P2-2 (in-place update spike) and P1-1 (Plan Object shape)._

- [ ] **P6-1. Card template:** renders activity, venue, datetime, cost tier, rationale, and per-attendee RSVP state from the `PlanObject` shape. Rendering/snapshot tests.
- [ ] **P6-2. In-place card update on revision** — same card edited, not a new message posted. Tests.
- [ ] **P6-3. Poll-style component** for quick binary asks ("does Saturday work?"). Tests.

## Phase 7 — Integration, Security & Demo Readiness

_Depends on everything above._

- [ ] **P7-1. Full automated end-to-end test** replaying the §11 demo script — seeded chat → silence → proposed plan → pushback → revised plan → confirmed — against the whole pipeline with externals mocked.
- [ ] **P7-2. Manual dry run** against a real/sandboxed Spectrum test group and real Merge sandbox, checklist-based, not automated.
- [ ] **P7-3. Webhook/gRPC reliability check under simulated demo network conditions** — the §12 risk explicitly called out as "test this early, not night-of." Confirm it actually holds up under a burst of messages, not just one at a time.
- [ ] **P7-4. Classifier tuning pass:** run P3-2 against real and seeded sample transcripts, tune the false-positive rate, and document the threshold and rationale in a short note — this is the difference §12 calls out between "charming and annoying."
- [ ] **P7-5. Security pass** across the whole app against the [AGENTS.md](./AGENTS.md) checklist: group-scoping/access-control audit (can group A's data leak via a request that only proves membership in group B?), dependency audit, secret-scan clean, and a review of every external-input Zod boundary.
- [ ] **P7-6. Final demo rehearsal + sign-off:** run the §11 demo script live, start to finish, with no manual intervention beyond the scripted human chat actions.

---

**Done** means every box above is checked, `main` is green on CI, and P7-6 has succeeded at least once without manual patching mid-run.

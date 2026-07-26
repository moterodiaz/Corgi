# Build Playbook — Corgi Parallel Build

This file is the operating manual for building Corgi with four engineer-agents
working in parallel. It doesn't repeat what other docs already own — it's the
thin layer that maps four people onto [TASKS.md](./TASKS.md)'s task backlog so
they can move concurrently without colliding.

Read order: [design-doc.md](./design-doc.md) (product intent) →
[TECH_STACK.md](./TECH_STACK.md) (what to build with) →
[TASKS.md](./TASKS.md) (the actual task/phase backlog, `P0-1`-style IDs) →
this file (how four people fan out over that backlog) →
[AGENTS.md](./AGENTS.md) (the per-PR checklist) →
[branch-sync.md](./branch-sync.md) (the sync agent invoked after every step).

**Mission:** an ambient AI agent that lives in an iMessage group chat, learns
what the group wants, and proposes/revises a real hangout plan — Photon for
transport, Merge for tools, Claude for reasoning (design-doc §1).

**Merge model:** PR-based. `main` is protected — no direct commits, no
force-push, no self-merge. Every change lands via branch → PR → 1 review +
green CI → merge (AGENTS.md §6, branch-sync.md).

---

## Foundation — Phase 0 + Phase 1 land before anyone forks

[TASKS.md](./TASKS.md) Phase 0 (`P0-1`…`P0-8`: decisions, credentials, repo
scaffold, CI, `.env`, README) and Phase 1 (`P1-1`…`P1-3`: the shared Zod
schemas, Prisma schema, and repository layer) must merge to `main` first.
These are the contracts everything else depends on — once merged they're
**frozen**: changing `/src/types`, `prisma/schema.prisma`,
`/src/claude/models.ts`, or any interface in `/src/tools`/`/src/transport`
(`TransportPort`) after this point is a `[CONTRACT CHANGE]` PR (AGENTS.md
§6), not a normal edit. `P1-4` (seed fixtures) can be picked up by anyone
once `P0-1` (data-source decision) lands.

One person (or the orchestrator) drives Phase 0/1 to green before the
four-way fork below starts — forking earlier just means everyone rebuilds
the same contracts differently and fights about it later.

---

## Four engineers → four phase clusters

This is a **starting assignment**, not permanent file ownership. Once your
cluster's tasks are merged or blocked on another lane, pick up any unclaimed
task from [TASKS.md](./TASKS.md) rather than sitting idle — check with the
orchestrator first if it's unclear whether it's actually unclaimed.

| Engineer | Starts on | Depends on | Notes |
|---|---|---|---|
| **E1 — Transport** | Phase 2 (`P2-1`…`P2-6`, Photon/Spectrum) then Phase 6 (`P6-1`…`P6-3`, mini-app card) | Phase 0/1 only | Do `P2-1`/`P2-2` (live-docs spikes) first — they block the rest of Phase 2 and all of Phase 6. |
| **E2 — Reasoning** | Phase 3 (`P3-1`…`P3-5`, Claude context/classifier/synthesis/diff) | Phase 1 (needs schemas + repos) | Independent of E1/E3 — can run fully in parallel with them. |
| **E3 — Tools** | Phase 4 (`P4-1`…`P4-5`, Merge Agent Handler) | `P0-1` (data source), `P0-2` (Merge creds) | `P4-1` (live tool-registration API spike) first. `P4-5` wires into E2's `P3-4` once both exist. |
| **E4 — Orchestrator** | Phase 5 (`P5-1`…`P5-4`, state machine) | Phase 1 for `P5-1`; full Phase 2/3/4 for `P5-2` | `P5-1` (state machine + transition table) can start immediately against Phase 1's `PlanObject` shape alone — build `P5-2`'s full wiring against mocks of E1/E2/E3's interfaces, swap in the real thing as each lands. |

Phase 7 (`P7-1`…`P7-6`: integration, security pass, demo rehearsal) is
cross-cutting and comes last — whoever's free picks it up once Phases 2–6
are merged, not one lane's permanent job.

- Each engineer owns the tests for the tasks they're doing, under
  `/tests/{unit,integration}` (plus `/tests/fixtures` for anyone touching
  seed data).
- Lanes couple only through the Phase 1 types/interfaces, so a lane can build
  against a typed stub while a dependency lane is still in flight (E4 wires
  `P5-2` against `TransportPort` and `synthesizePlan()`'s signature without
  waiting on E1/E2's implementation).
- **Never edit a file outside the task you're doing** to "make it work" —
  surface it instead (AGENTS.md §6).

---

## Per-task loop

For each `TASKS.md` task you pick up:

1. Pull latest `main`; branch named `<area>/<task-id>-<short-desc>` (e.g.
   `feedback/P3-5-diff-layer`), `<area>` matching the TECH_STACK.md folder.
2. Build it. Non-negotiables from AGENTS.md: Zod-parse everything crossing a
   boundary; explicit timeout + explicit fallback on every Claude/Merge/
   Spectrum call — no bare `try {} catch {}`; every state-changing action
   scoped to its group.
3. Real tests per the task's own description in TASKS.md, plus the shared
   "definition of done" at the top of that file (failure/edge case covered,
   not just happy path).
4. `pnpm check` green.
5. Run **branch-sync** (see [branch-sync.md](./branch-sync.md) — do not
   duplicate its steps here, it's the single source of truth for the sync
   loop). Run it after every green step, not just before opening the PR, so
   the branch never drifts far from `main`.
6. Open/update the PR (branch-sync does this). Prefix the title
   `[CONTRACT CHANGE]` if it touches a frozen contract. Wait for one real
   review + green CI, then merge, delete the branch.
7. Check off the task in `TASKS.md` in the same PR. Back to step 1 for the
   next task.

### `/loop` integration

Wrap steps 1–6 in `/loop` per engineer so branch-sync fires automatically on
every green self-check — event-driven, not a blind timer. Keeps branches
short-lived so rebases stay small.

---

## Merge-conflict avoidance, summarized

- Phase 0/1 frozen before fan-out → the highest-churn files (`types`, schema,
  `models.ts`) don't move under everyone's feet.
- Phase clustering → engineers aren't editing the same files in the same
  week, even though it's not a permanent ownership lock.
- Contract changes are serialized and loud (`[CONTRACT CHANGE]`), never
  quiet.
- Sync-after-every-green-step keeps each branch's rebase small.
- Out-of-lane conflict → branch-sync stops and surfaces it. Nobody resolves a
  conflict in code they don't understand by guessing which side is right.

## Reference index

- [design-doc.md](./design-doc.md) — product intent and architecture.
- [TECH_STACK.md](./TECH_STACK.md) — what to build with, repo layout.
- [TASKS.md](./TASKS.md) — the task/phase backlog this file maps engineers onto.
- [AGENTS.md](./AGENTS.md) — the per-PR checklist and the *why* behind it.
- [branch-sync.md](./branch-sync.md) — the sync agent invoked after every
  green step; owns the sync-loop mechanics, not duplicated here.

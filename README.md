# Corgi — iMessage Hangout Planner Agent

An ambient AI agent that lives in an iMessage group chat, quietly learns what the group wants, and proposes a real plan. See [design-doc.md](./design-doc.md) for product intent and [TECH_STACK.md](./TECH_STACK.md) for stack decisions.

**Setting this up for the live demo?** Just run `./setup.sh` — it installs everything, starts BlueBubbles, and starts the demo listener.

## Quick start

```bash
git clone https://github.com/moterodiaz/Corgi.git && cd Corgi
pnpm install                # installs deps + runs prisma generate via postinstall
cp .env.example .env         # fill in ANTHROPIC_API_KEY/MERGE_API_KEY yourself — see §Environment variables
pnpm db:migrate              # creates the initial SQLite migration + dev.db
pnpm bluebubbles:install     # one-time: installs/configures BlueBubbles Server locally (see §BlueBubbles setup)
pnpm bluebubbles:start       # ensures BlueBubbles is up, then starts Corgi on http://localhost:3000
```

Verify it's running:

```bash
curl http://localhost:3000/health
# → {"status":"ok"}
```

A real `ANTHROPIC_API_KEY` is required for anything Claude-backed (context
extraction, plan synthesis/feedback, the demo scripts below) to actually
work — the server itself will boot with a placeholder key, but those calls
will fail at runtime without a real one.

## Run tests

```bash
pnpm test
```

Tests use a separate `test.db` (created and destroyed automatically by `vitest globalSetup`). No `.env` needed for tests — dummy values are injected by `vitest.config.ts`.

## Full check (typecheck + lint + test + build)

```bash
pnpm check
```

This is what CI runs. It must pass before any PR merges.

## BlueBubbles setup

This branch replaces the paid Photon/Spectrum iMessage transport with
[BlueBubbles Server](https://bluebubbles.app) — self-hosted, runs locally on
this Mac, no per-seat cost, and supports group chats. See
[TECH_STACK.md](./TECH_STACK.md)'s Transport section for the full rationale
and API details.

```bash
pnpm bluebubbles:install   # one-time: download, install, configure
pnpm bluebubbles:start     # every time: ensure it's running, then start Corgi
```

`bluebubbles:install` automates everything a script safely can (download the
latest release, install to `/Applications`, set the server password/port via
its documented CLI args). It **cannot** grant Full Disk Access or sign this
Mac into iMessage — those are real macOS security prompts requiring your
manual click. The script prints exact steps and opens the right System
Settings pane. Once granted, add this Mac's iMessage number to a group chat
the same way you'd add any person — no BlueBubbles API call is needed for
that part.

## Demo

Two scripts exist for rehearsing/running the "believable group chat" demo
(see [design-doc.md](./design-doc.md) for the product intent behind it):

- **`pnpm demo:rehearsal`** — runs entirely on one machine, no real
  iMessages sent. Simulates a ~2-day buildup conversation between two
  personas, then a scripted live moment (trigger → proposal → pushback →
  revision → confirmation), all through the exact same code the live demo
  uses (`src/demo/persona-chat.ts`'s `decideNextLine`, the real
  `HangoutOrchestrator`) — only the transport is swapped for a
  console-logging stub. Use this to check pacing, style, and that the
  propose/feedback/revise/confirm loop actually converges, before touching
  real devices. Requires a real `ANTHROPIC_API_KEY`. Edit the `AK`/`FRIEND`
  persona blocks at the top of `scripts/demo-rehearsal.ts` with real samples
  of how each person actually texts before running.

- **`pnpm demo:persona-relay`** — the live, multi-device version. Runs on
  each participant's own Mac (one process per person, including the
  organizer if they want an AI-driven "buildup" persona of themselves), each
  watching the _same real group chat_ through that Mac's own local
  BlueBubbles connection and speaking as one specific person in it. There is
  **no networking between these processes** — each machine only ever reacts
  to messages it actually observed arrive over its own connection, exactly
  like a real person reading the thread on their own phone. This is what
  keeps the timing honest: no persona can ever reference something that
  hasn't actually been said yet. See the setup steps and comments at the top
  of `scripts/persona-relay.ts` — each machine needs its own BlueBubbles
  install, the shared chat's GUID in `DEMO_GROUP_CHAT_GUID`, and its own
  edited `PERSONA` block (name + a real texting sample + a few loose
  topics).

The real `HangoutOrchestrator` bot (`pnpm bluebubbles:start`) should be
running on exactly one machine in the group — typically the organizer's,
since that's also the number BlueBubbles sends as. It behaves like a
distinct participant in style (warm, structured proposal/revision/
confirmation messages) even when it shares a phone number with a
persona-relay process on the same machine.

## Other scripts

| Script                          | What it does                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                     | ESLint only                                                                                                                                                                             |
| `pnpm format`                   | Prettier write                                                                                                                                                                          |
| `pnpm build`                    | Compile `src/` → `dist/`                                                                                                                                                                |
| `pnpm db:migrate`               | Run Prisma migrations (run once after install, and after schema changes)                                                                                                                |
| `pnpm db:generate`              | Regenerate Prisma client without migrating                                                                                                                                              |
| `pnpm bluebubbles:install`      | One-time BlueBubbles Server download/install/configure                                                                                                                                  |
| `pnpm bluebubbles:start`        | Ensure BlueBubbles is running, then start Corgi's dev server                                                                                                                            |
| `pnpm bluebubbles:listen`       | Standalone smoke test — logs every real inbound message/reaction live                                                                                                                   |
| `pnpm bluebubbles:trigger-test` | One-shot round-trip test — waits for a message starting with "friend group" (from anyone, including the operator's own devices) in any chat, then replies into that same chat and exits |
| `pnpm demo:rehearsal`           | Local, single-machine rehearsal of the full buildup → propose → feedback → confirm demo flow — see §Demo                                                                                |
| `pnpm demo:persona-relay`       | Live, multi-device persona driver for the real demo — see §Demo                                                                                                                         |

## Node version

Pinned to **v24.18.0** (Node Active LTS "Krypton" as of 2026-07-25, verified at nodejs.org). Use `nvm use` or the `.nvmrc` file.

## Environment variables

Copy `.env.example` to `.env` and fill in real values. All vars are validated at startup via Zod (`src/config.ts`) — the server will throw on boot if any are missing.

| Variable                      | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`           | Anthropic API key for Claude calls                                          |
| `MERGE_API_KEY`               | Merge unified API key                                                       |
| `DATABASE_URL`                | Prisma datasource URL (e.g. `file:./dev.db` for local SQLite)               |
| `BLUEBUBBLES_SERVER_URL`      | Local BlueBubbles Server URL (default `http://127.0.0.1:1234`)              |
| `BLUEBUBBLES_SERVER_PASSWORD` | BlueBubbles Server password — set by `pnpm bluebubbles:install`             |
| `DEMO_GROUP_CHAT_GUID`        | Only for `pnpm demo:persona-relay` — the live demo's shared group chat GUID |

## Secret scanning (gitleaks)

The pre-commit hook in `.husky/pre-commit` has a commented line for `gitleaks`. To enable:

1. Install gitleaks: `brew install gitleaks` (macOS) or see [gitleaks releases](https://github.com/zricethezav/gitleaks/releases).
2. Uncomment the `gitleaks protect --staged --redact` line in `.husky/pre-commit`.

CI does not currently run gitleaks — add a `gitleaks/gitleaks-action` step to `ci.yml` once the binary is available in the runner.

## Open decisions (human/admin — not done by this scaffold)

- **P0-1 — Venue/event data source:** real Merge-connected source (Yelp-like API, ticketing API, curated dataset) vs. seeded static dataset. This blocks P1-4 (fixtures) and all of Phase 4 (Merge tools). The placeholder fixture in `tests/fixtures/venues.ts` is demo-only until this is decided.
- **P0-2 — Credentials/accounts:** Anthropic API key, Merge sandbox key. BlueBubbles replaces the Photon/Spectrum account requirement — see §BlueBubbles setup — but still needs a Mac signed into iMessage with a real number/Apple ID, which is an account-level prerequisite no install script can satisfy.
- **P0-3 — GitHub branch protection (needs admin access):** require the `pnpm check` status check, require at least one review, disallow force-push and direct commits to `main`.

## Repository layout

```
src/
  config.ts               # env validation (Zod) — only file that reads process.env
  server.ts                # Fastify app + /health route + startHangoutBot() wiring
  claude/
    models.ts              # model ID constants — import from here, never hardcode
    client.ts               # ClaudeClient / callStructured forced-tool-use wrapper
    context-extraction.ts   # periodic transcript -> profile-delta extraction (Phase 3)
    speak-classifier.ts     # "should I speak now" classifier (Phase 3)
    plan-synthesis.ts       # candidate retrieval + plan/message synthesis (Phase 3)
    plan-feedback.ts        # classifies inbound messages as plan feedback (Phase 5)
  types/                   # shared Zod schemas (Plan, Profile, Transcript, TransportPort)
  store/                    # Prisma repositories (plan, profile, transcript)
  transport/                # BlueBubbles adapter (Phase 2) — see TECH_STACK.md
  orchestrator/
    hangout-orchestrator.ts # wires transcript -> extraction -> classify -> synthesis -> feedback loop into a running bot (Phase 5)
    plan-state-machine.ts   # Plan status transitions (proposed/revising/confirmed/abandoned)
  demo/
    persona-chat.ts         # shared "what would this persona say next" generator, reactive-only by design
  tools/                    # Merge Agent Handler wrappers (Phase 4)
scripts/
  bluebubbles-*.ts/.sh       # install/start/listen/trigger-test dev tooling — see §BlueBubbles setup
  demo-rehearsal.ts          # local single-machine demo rehearsal — see §Demo
  persona-relay.ts           # live multi-device demo driver — see §Demo
tests/
  fixtures/                  # demo-only seeded data (not production logic)
  globalSetup.ts             # creates test.db before vitest run
prisma/
  schema.prisma              # SQLite schema (swap provider for Postgres with no code changes)
```

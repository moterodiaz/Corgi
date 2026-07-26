# Corgi — iMessage Hangout Planner Agent

An ambient AI agent that lives in an iMessage group chat, quietly learns what the group wants, and proposes a real plan. See [design-doc.md](./design-doc.md) for product intent and [TECH_STACK.md](./TECH_STACK.md) for stack decisions.

## Quick start

```bash
git clone <repo-url> && cd Corgi
pnpm install                # installs deps + runs prisma generate via postinstall
cp .env.example .env         # fill in ANTHROPIC_API_KEY/MERGE_API_KEY yourself
pnpm db:migrate              # creates the initial SQLite migration + dev.db
pnpm bluebubbles:install     # one-time: installs/configures BlueBubbles Server locally (see §BlueBubbles setup)
pnpm bluebubbles:start       # ensures BlueBubbles is up, then starts Corgi on http://localhost:3000
```

Verify it's running:

```bash
curl http://localhost:3000/health
# → {"status":"ok"}
```

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

## Node version

Pinned to **v24.18.0** (Node Active LTS "Krypton" as of 2026-07-25, verified at nodejs.org). Use `nvm use` or the `.nvmrc` file.

## Environment variables

Copy `.env.example` to `.env` and fill in real values. All vars are validated at startup via Zod (`src/config.ts`) — the server will throw on boot if any are missing.

| Variable                      | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`           | Anthropic API key for Claude calls                              |
| `MERGE_API_KEY`               | Merge unified API key                                           |
| `DATABASE_URL`                | Prisma datasource URL (e.g. `file:./dev.db` for local SQLite)   |
| `BLUEBUBBLES_SERVER_URL`      | Local BlueBubbles Server URL (default `http://127.0.0.1:1234`)  |
| `BLUEBUBBLES_SERVER_PASSWORD` | BlueBubbles Server password — set by `pnpm bluebubbles:install` |

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
  config.ts           # env validation (Zod) — only file that reads process.env
  server.ts           # Fastify app + /health route
  claude/models.ts    # model ID constants — import from here, never hardcode
  types/              # shared Zod schemas (Plan, Profile, Transcript, TransportPort)
  store/              # Prisma repositories (plan, profile, transcript)
  transport/          # BlueBubbles adapter (Phase 2) — see TECH_STACK.md
  orchestrator/       # state machine (Phase 5)
  context/            # context extraction layer (Phase 3)
  synthesis/          # plan synthesis layer (Phase 3)
  feedback/           # feedback/diff layer (Phase 3)
  tools/              # Merge Agent Handler wrappers (Phase 4)
tests/
  fixtures/           # demo-only seeded data (not production logic)
  globalSetup.ts      # creates test.db before vitest run
prisma/
  schema.prisma       # SQLite schema (swap provider for Postgres with no code changes)
```

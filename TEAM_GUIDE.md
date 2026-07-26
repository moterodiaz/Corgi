# Team Guide — Corgi, in plain English

This is the human-readable companion to `BUILD_PLAYBOOK.md` and `TASKS.md`.
Those two are the source of truth (task IDs, exact dependencies, PR rules) —
this file just explains, in normal language, what we're building, who does
what, and how we know we're done.

## What we're building

An AI agent that lives quietly in an iMessage group chat. It listens, figures
out what the group actually wants to do, and — when the moment's right —
proposes a real hangout plan with a tappable card. People can push back in
plain language and it revises the plan instead of starting over.

## The shape of the work

```
Foundation (1 person)  →  4 lanes in parallel  →  Phase 7 rejoin  →  Done
```

One person builds the shared foundation first. Then four of us split and
build in parallel, mostly not touching each other's files. Then we rejoin for
a final phase that proves the whole thing actually works together and
rehearses the demo. "Done" is the end of that last phase, not the moment all
four lanes merge.

## What each phase actually does

`TASKS.md` breaks the build into 8 phases (P0–P7). In plain terms:

- **P0 — Setup:** get API keys/accounts, decide where venue/event data comes
  from, stand up the empty project with CI running.
- **P1 — Shared contracts:** define the shapes of our data (a plan, a person's
  profile, etc.) and the database, once, so everyone agrees before building
  on top.
- **P2 — Transport:** make the agent able to actually read and send iMessage
  messages, via Photon.
- **P3 — Reasoning:** the Claude brains — deciding when to speak, learning
  what people want, proposing a plan, revising it.
- **P4 — Tools:** connect real venue/event search and calendar availability,
  via Merge.
- **P5 — Orchestrator:** the state machine that wires everything above into
  one working loop (proposed → revising → confirmed).
- **P6 — Widget:** the tappable plan card people see in the chat.
- **P7 — Hardening & demo:** prove the whole pipeline works end-to-end,
  security-review it, rehearse the live demo.

## Who does what when we split

After the foundation (P0/P1) is merged, four of us split into lanes. These
are starting points, not permanent turf — once your lane's tasks are done,
grab any open task in `TASKS.md` rather than sitting idle.

| You | You build | Blocked on |
|---|---|---|
| **E1 — Transport** | P2 (iMessage plumbing), then P6 (the card widget) | Just the foundation |
| **E2 — Reasoning** | P3 (the Claude logic) | Foundation's shared data shapes |
| **E3 — Tools** | P4 (Merge venue/calendar tools) | The data-source decision + Merge account from P0 |
| **E4 — Orchestrator** | P5 (the state machine) | Can start right away on the core logic; needs P2/P3/P4 finished to wire the *whole* loop together |

Lanes mostly don't touch each other's files. Where one lane needs something
another hasn't built yet (e.g. E4 needs E1's messaging code), build against a
stand-in and swap in the real thing once it lands — see `BUILD_PLAYBOOK.md`.

## Do we build the foundation first? Yes.

One person drives P0 and P1 to green on `main` *before* the four-way split
starts. Those two phases define the shared data shapes and database — the
things every other phase builds on top of. If we split before that's done,
we all end up inventing slightly different versions of the same thing and
have to untangle it later.

Once P0/P1 are merged, those shapes are **frozen**. Nobody just edits them
later — changing one is a special, flagged kind of pull request
(`[CONTRACT CHANGE]`) with a heads-up to whoever else is mid-build, so nobody
gets blindsided.

## When are we actually finished?

Not "when all four lanes are merged." That just means the individual pieces
exist — it doesn't mean they work together.

**We're done when:**
1. Every box in `TASKS.md` is checked, and
2. `main` is green on CI, and
3. Phase 7's live demo rehearsal (`P7-6`) has run start-to-finish at least
   once with no manual patching mid-run.

Phase 7 is a real rejoin phase, not cleanup — it's where we run the full
end-to-end test, do a manual dry run against real Spectrum/Merge sandboxes,
check the system holds up under a burst of messages, tune the "should I
speak" classifier against real transcripts, run a security pass, and
rehearse the demo live. Whoever's free after their lane wraps picks this up
— it's not any one person's permanent job, but it does happen *after*
everyone else's work is merged, not in parallel with it.

## Day-to-day rhythm

For each task you pick up:

1. Branch off latest `main`.
2. Build it, with real tests (per `TASKS.md`'s definition of done).
3. Run `pnpm check` — must be green.
4. Run branch-sync — it rebases you onto the latest `main` and opens/updates
   your PR automatically. If you're running `/loop`, this happens on its own
   after every step that passes its self-check, so your branch never goes
   stale.
5. Get one real review, wait for CI, merge.
6. Check the task off in `TASKS.md`.

## Where to go for more detail

- `BUILD_PLAYBOOK.md` — the machine-facing version of this file (exact lane
  rules, contract-change process, sync-loop mechanics).
- `TASKS.md` — the actual task list with IDs and dependencies.
- `AGENTS.md` — the full per-PR checklist (testing, security, error handling).

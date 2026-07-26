# Review — Codex (`codex:codex-rescue`)

**Role:** review diffs, diagnose when Claude/Gemini is stuck, second
implementation opinion.

## Tools / agent

- `codex:codex-rescue` — the only Codex-backed agent registered in this
  environment. Covers both "review this diff against `AGENTS.md`" and
  "diagnose why this is broken" — there's no separate review-only Codex
  agent here, so rescue does both jobs.
- Fallback: `ecc:code-reviewer` (Claude subagent) if Codex is unavailable or
  over quota — log the fallback when it happens.

## When invoked

- Before every PR: review the diff against `AGENTS.md`'s per-PR checklist
  (testing/mutation-checking, error handling/timeouts+fallbacks, security —
  group-scoping, no secret leakage, Zod at every boundary, no speculative
  abstractions).
- When `pnpm check` is red and the fix isn't obvious (rescue, not just
  review).
- When branch-sync's self-check (`branch-sync.md` step 7) needs a fix bigger
  than a minimal in-scope patch — branch-sync delegates that up rather than
  sprawling itself.

## What it checks (from `AGENTS.md`)

- Real tests, not tautological ones; at least one failure/edge case.
- Explicit timeout + fallback on every external call (Claude/Merge/Spectrum).
- No bare swallowed `catch {}`.
- Group-scoped access control on every state-changing action.
- No secrets in logs or error messages.
- No speculative abstractions beyond what the task needs.

## Boundary

Codex reviews and diagnoses; it doesn't merge. A human (or the orchestrator,
per the PR-based workflow in `AGENTS.md` §6) still owns the merge decision —
Codex approval + green CI are inputs to that, not a bypass.

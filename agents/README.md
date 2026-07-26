# Agent Workflow — Corgi

Three roles, three tools. This is the routing policy from the orchestrator's
global `CLAUDE.md`, applied to this repo. It governs _how work gets done_, not
_what_ gets done (that's [TASKS.md](../TASKS.md)) or _who's on which lane_
(that's [BUILD_PLAYBOOK.md](../BUILD_PLAYBOOK.md)).

| Role            | Who                           | Does                                                                                 | Never does                          |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| **Orchestrate** | Claude                        | Decompose tasks, delegate, review diffs, synthesize, sequence `TASKS.md`, write docs | Write implementation code directly  |
| **Grunt work**  | Gemini (`mcp__agy-bridge__*`) | Heavy multi-file analysis, research, mechanical scaffold/impl                        | Own final review sign-off           |
| **Review**      | Codex (`codex:codex-rescue`)  | Code review, second-opinion diagnosis, unstick Claude                                | Author the first draft of a feature |

## When to use which

**Writing code (feature, fix, refactor):**

1. `codex:codex-rescue` — first choice for substantial implementation.
2. `developer-core` subagent — fallback, or when the task is mechanical/
   fast-path (e.g. boilerplate scaffold) and doesn't need Codex's judgment.
3. `mcp__agy-bridge__analyze_files` (Gemini) first, _then_ Codex, if the task
   needs multi-file archaeology before anyone can write code sensibly.

**Reviewing code (before opening/merging a PR):**

1. `codex:codex-rescue` — primary. (No separate Codex-backed `code-review`
   agent is registered in this environment; rescue covers both diagnosis and
   review.)
2. `ecc:code-reviewer` — fallback if Codex is unavailable or over quota.

**Heavy analysis / research** (>3 files, logs, cross-file archaeology, live
docs lookup — e.g. confirming the current Spectrum/Merge API shape per
[TECH_STACK.md](../TECH_STACK.md)'s "verify against live docs" rule):

1. `mcp__agy-bridge__analyze_files` — files never enter Claude's context.
2. `mcp__agy-bridge__deep_search` — git/grep archaeology.
3. `mcp__agy-bridge__web_lookup` — docs/API lookup with live web access.
4. `mcp__agy-bridge__delegate` — anything else heavy.

**Planning / architecture / decomposition:** Claude, directly. This includes
writing `agents/`, `BUILD_PLAYBOOK.md`, `TEAM_GUIDE.md` — docs are not
"implementation code" under this policy.

**Quota hit:** if Codex is unavailable, log it and fall back to
`developer-core` / `ecc:code-reviewer` for the rest of the session.

## Fits into the existing loop

This routing sits _inside_ the per-task loop in
[BUILD_PLAYBOOK.md](../BUILD_PLAYBOOK.md): build (Codex/Gemini/developer-core)
→ `pnpm check` → [branch-sync](../branch-sync.md) (rebase + PR) → Codex review
→ merge. It doesn't replace any step there, it just says which agent does
which step.

## Per-role detail

- [orchestrator.md](./orchestrator.md)
- [gemini-grunt.md](./gemini-grunt.md)
- [codex-review.md](./codex-review.md)

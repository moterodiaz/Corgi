# Grunt work — Gemini (`mcp__agy-bridge__*`)

**Role:** heavy lifting that doesn't need Claude's judgment call — multi-file
analysis, research, mechanical implementation. Files/logs analyzed this way
never enter Claude's context, which keeps big sweeps cheap.

## Tools

- `analyze_files` — read/summarize/reason over a batch of files (>3 files, a
  log dump, a data fixture) without pulling them into Claude's context.
- `deep_search` — git/grep archaeology (e.g. "when did this contract
  change", "find every caller of `TransportPort.sendMessage`").
- `web_lookup` — live docs/API lookup. Use this for the "verify against live
  docs, don't trust training data" checks `TECH_STACK.md` calls out for
  Spectrum (`P2-1`) and Merge (`P4-1`).
- `delegate` — catch-all for other heavy tasks that don't fit the above.

## When invoked

- A `TASKS.md` spike task (`P2-1`, `P2-2`, `P4-1`) that needs current
  external docs, not memorized API shapes.
- Any task touching more files than fit comfortably in one review pass.
- Not yet exercised for this foundation build — the P0/P1 scaffold is small
  and mechanical enough to go straight to `developer-core`. Wire this in once
  the four-lane fork starts and tasks get bigger (e.g. `P5-2`'s full-loop
  wiring, `P7-5`'s security pass).

## Boundary

Gemini does not get final sign-off on correctness — its output still needs a
Codex review pass (or Claude's direct read) before merging.

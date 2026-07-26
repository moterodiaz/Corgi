# P2-2 Spike: Mini-App Card In-Place Update Verification

## Goal
Verify whether iMessage mini-app cards can be updated in place (same bubble updated, no new bubble) in our real Spectrum sandbox setup.

## Source Basis
- TASKS.md P2-2 requirement.
- Spectrum docs:
  - app card updates via `space.send(edit(app(...), originalCardMessage))`
  - update requires cloud iMessage provider (`@spectrum-ts/imessage`)

## Spike Script
- Script path: `scripts/p2-2-miniapp-inplace-update-spike.ts`
- Trigger message text in test chat: `!p2-2-card-update`

Script behavior:
1. Wait for the trigger text in an inbound message.
2. Send initial app card URL (`P2_INITIAL_URL`).
3. Wait `P2_UPDATE_DELAY_MS`.
4. Call `edit(app(updatedUrl), originalCardMessage)`.
5. Post a confirmation text asking the observer to verify UI behavior.

## Run Prerequisites
1. A Spectrum project with iMessage cloud provider configured.
2. Env vars available in shell:
   - `SPECTRUM_PROJECT_ID`
   - `SPECTRUM_PROJECT_SECRET`
3. A test iMessage conversation where the bot can send messages.
4. Runtime able to execute TypeScript script (for example `tsx`).

## Suggested Run Command
Example only (depends on your scaffold/runtime setup):

```bash
P2_INITIAL_URL='https://example.com/corgi/p2-2?step=initial' \
P2_UPDATED_URL='https://example.com/corgi/p2-2?step=updated' \
P2_UPDATE_DELAY_MS=4000 \
P2_TRIGGER='!p2-2-card-update' \
pnpm tsx scripts/p2-2-miniapp-inplace-update-spike.ts
```

## Evidence to Capture
- Terminal logs showing:
  - trigger receipt
  - initial card send message id
  - edit invocation target message id
- iMessage screen recording or screenshots showing one of:
  - PASS: same bubble updates in place
  - FAIL: second bubble posted instead of in-place update
  - PARTIAL: in-place update works only under specific conditions

## Result Matrix
- Sandbox account/test line: Spectrum sandbox test chat (user-verified).
- Platform/runtime (Node or Bun): Node + pnpm + local `tsx` runner.
- Live render option (`live: true`) outcome: initial widget card rendered successfully.
- In-place update outcome: PASS (user confirmed same card bubble updated in place).
- Any constraints observed:
  - zsh history expansion requires quoting values containing `!` (for trigger text).
  - Script requires cloud credentials in the same process invocation.

## Evidence Captured
- Terminal startup logs confirmed listener and config values:
  - `[P2-2] listening for trigger: !p2-2-card-update`
  - `[P2-2] initial URL: https://example.com/corgi/p2-2?step=initial`
  - `[P2-2] updated URL: https://example.com/corgi/p2-2?step=updated`
  - `[P2-2] update delay ms: 4000`
- iMessage observation:
  - Received Spectrum widget message (example domain), followed by confirmation text from the script.
  - User reported final result as `PASS` for in-place update behavior.

## Decision for Phase 6
- If PASS: proceed with Phase 6 assumption that revisions can update existing card.
- If FAIL/PARTIAL: document fallback UX (new card post plus "revised" marker) before P6-2 implementation.

### Current Decision
Proceed with the Phase 6 assumption that mini-app card revisions can update the existing card in place.

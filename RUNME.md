# Agent instructions — run this exactly

You are setting up one machine's participation in a 3-device live demo. Another
machine already sent the trigger phrase "friend group" in a real iMessage group
chat that this Mac must already be a member of (added the same way you'd add
any person, using this Mac's iMessage number). Do the following, in order,
without stopping to ask questions unless a step genuinely fails:

1. Confirm prerequisites: Node.js >= 24.18.0, pnpm, and a Mac signed into
   iMessage with its own number/Apple ID (not shared with any other machine
   in the demo).

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Set up BlueBubbles Server (self-hosted iMessage bridge — this is what lets
   this Mac send/receive real iMessages programmatically). This step needs a
   real human at the keyboard for two things only: granting Full Disk Access,
   and confirming this Mac is signed into iMessage. Everything else is
   automatic.

   ```bash
   pnpm bluebubbles:install
   ```

   Follow the printed instructions exactly. If it asks you to grant Full Disk
   Access in System Settings, wait for the human to do that, then continue.

4. Start BlueBubbles Server:

   ```bash
   pnpm bluebubbles:start
   ```

   Leave this running in its own terminal/background process.

5. Verify BlueBubbles is actually reachable before continuing:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:1234
   ```

   This must print `200`. If it doesn't, BlueBubbles Server isn't running —
   go back to step 4 and fix it before proceeding. Do not proceed on a guess.

6. Make sure the human has been added to the real group chat other devices
   in this demo are using (ask them to confirm, or check with
   `pnpm bluebubbles:listen` — send any message into the target chat from
   any device and confirm it logs here).

7. Start the demo listener:

   ```bash
   pnpm demo:scripted
   ```

   It should print exactly one line ending in `waiting for a message
starting with "friend group"...` and then nothing else, and the process
   should keep running (not exit). If it prints an error or exits, read the
   error, fix the root cause (usually a missing/wrong `BLUEBUBBLES_SERVER_URL`
   / `BLUEBUBBLES_SERVER_PASSWORD` in `.env` — copy `.env.example` to `.env`
   if `.env` doesn't exist yet and fill those two in from step 3/4's output),
   and restart it. Confirm the listening line actually appears before telling
   the human you're done — do not report success without seeing it.

8. Report to the human: "Listening — ready for the trigger." Do not send any
   messages yourself, do not modify `scripts/demo-scripted.ts`, and do not
   run any other script. This one process handles everything from here: once
   anyone in the group chat sends a message starting with "friend group",
   it auto-detects whether this machine sent that trigger (in which case it
   drives the proposal/confirmation lines) or not (in which case it
   contributes the other participant lines), with no further input needed.

No `ANTHROPIC_API_KEY` is required for this path — `demo:scripted` is fully
scripted and only talks to BlueBubbles, never Claude.

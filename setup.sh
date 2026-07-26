#!/usr/bin/env bash
set -e

# Run this to get one machine ready for the 2-person demo. No manual config,
# no API key. Run the exact same script on both machines.
#
# Only ONE of the two people actually sends "friend group" in the shared
# group chat to kick things off — the other person does not also send it,
# they just wait. The script on each machine auto-detects which one you are
# the moment that message is sent (whoever's device sent it becomes the
# starter automatically) — you don't decide this in advance, and the two
# machines are not interchangeable once someone sends it.

pnpm install
bash scripts/bluebubbles-install.sh

echo "Launching BlueBubbles..."
open -a /Applications/BlueBubbles.app || true

echo "Waiting for BlueBubbles to respond on port 1234..."
until curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1234 2>/dev/null | grep -q 200; do
  sleep 2
done
echo "BlueBubbles is up."

echo "Starting the demo listener — leave this running until the demo is done."
pnpm demo:scripted

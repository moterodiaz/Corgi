#!/usr/bin/env bash
# One-time setup: download, install, and configure BlueBubbles Server
# (https://bluebubbles.app) locally on this Mac. Re-runnable safely.
#
# What this script CAN automate: download, install to /Applications,
# Gatekeeper allowance for the unsigned build, and setting the server
# password/port via documented CLI args (bluebubbles-server supports
# --password/--socket_port since v1.8.0 — see docs.bluebubbles.app's
# "Simplified Setup" post).
#
# What this script CANNOT automate (real macOS security boundaries — no
# script, including this one, can grant these on your behalf):
#   1. Full Disk Access for BlueBubbles.app (System Settings > Privacy &
#      Security > Full Disk Access) — required to read ~/Library/Messages.
#   2. Confirming this Mac is signed into iMessage with your Apple ID/number
#      (Messages.app > Settings > iMessage).
#   3. The one-time "Allow BlueBubbles to control System Events" Automation
#      popup that appears the first time it tries to send a message.
# This script prints exact instructions for those steps and opens the
# right System Settings pane for step 1.

set -euo pipefail

REPO="BlueBubblesApp/bluebubbles-server"
APP_PATH="/Applications/BlueBubbles.app"
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"

arch="$(uname -m)"
if [ "$arch" = "arm64" ]; then
  asset_pattern="*arm64.dmg"
else
  asset_pattern="BlueBubbles-*.dmg"
fi

if [ -d "$APP_PATH" ]; then
  echo "[bluebubbles-install] $APP_PATH already exists — skipping download/install."
else
  workdir="$(mktemp -d)"
  trap 'rm -rf "$workdir"' EXIT
  cd "$workdir"

  echo "[bluebubbles-install] Fetching latest release info for $REPO..."
  if command -v gh >/dev/null 2>&1; then
    gh release download --repo "$REPO" --pattern "$asset_pattern" --clobber
  else
    echo "[bluebubbles-install] gh CLI not found, falling back to the GitHub API directly (may hit rate limits)."
    latest_json="$(curl -sf "https://api.github.com/repos/$REPO/releases/latest")"
    download_url="$(echo "$latest_json" | grep -o '"browser_download_url": *"[^"]*'"${asset_pattern//\*/.*}"'"' | head -1 | sed -E 's/.*"(https[^"]+)"/\1/')"
    if [ -z "$download_url" ]; then
      echo "[bluebubbles-install] Could not resolve a download URL automatically." >&2
      echo "Download the .dmg yourself from https://github.com/$REPO/releases/latest and re-run this script, or install manually." >&2
      exit 1
    fi
    curl -sfL -o "bluebubbles.dmg" "$download_url"
  fi

  dmg_file="$(find . -maxdepth 1 -name '*.dmg' | head -1)"
  if [ -z "$dmg_file" ]; then
    echo "[bluebubbles-install] Download did not produce a .dmg file." >&2
    exit 1
  fi

  echo "[bluebubbles-install] Mounting $dmg_file..."
  mount_point="$(hdiutil attach "$dmg_file" -nobrowse | tail -1 | awk -F'\t' '{print $NF}')"

  echo "[bluebubbles-install] Installing to $APP_PATH..."
  cp -R "$mount_point/BlueBubbles.app" /Applications/
  hdiutil detach "$mount_point" >/dev/null

  echo "[bluebubbles-install] Installed."
fi

# The published build is code-signed but not notarized (BlueBubbles' Apple
# Developer account was revoked — see docs.bluebubbles.app), so Gatekeeper
# rejects it by default. Removing any quarantine flag lets it launch without
# the "unidentified developer" dialog; this only affects this one app.
xattr -d com.apple.quarantine "$APP_PATH" 2>/dev/null || true

if [ ! -f "$ENV_FILE" ]; then
  echo "[bluebubbles-install] No .env found at $ENV_FILE — copying .env.example. Fill in ANTHROPIC_API_KEY/MERGE_API_KEY yourself." >&2
  cp "$(dirname "$ENV_FILE")/.env.example" "$ENV_FILE"
fi

password="$(grep -m1 '^BLUEBUBBLES_SERVER_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || true)"
if [ -z "$password" ] || [ "$password" = "your-bluebubbles-server-password-here" ]; then
  password="corgi-local-$(openssl rand -hex 12)"
  if grep -q '^BLUEBUBBLES_SERVER_PASSWORD=' "$ENV_FILE"; then
    sed -i '' "s/^BLUEBUBBLES_SERVER_PASSWORD=.*/BLUEBUBBLES_SERVER_PASSWORD=$password/" "$ENV_FILE"
  else
    echo "BLUEBUBBLES_SERVER_PASSWORD=$password" >>"$ENV_FILE"
  fi
  echo "[bluebubbles-install] Generated a server password and saved it to .env."
fi

echo "[bluebubbles-install] Launching BlueBubbles Server (first run — this opens its setup window)..."
open -a "$APP_PATH" --args --password "$password" --socket_port 1234

cat <<'EOF'

============================================================
BlueBubbles Server is launching. Three manual steps remain —
these are real macOS security prompts; nothing can script them:

  1. FULL DISK ACCESS (required — the server can't read your
     Messages database without it):
       System Settings > Privacy & Security > Full Disk Access
       > click "+" > select BlueBubbles.app > toggle it ON.
       (Opening that pane for you now.)

  2. Confirm this Mac is signed into iMessage with your number:
       Messages.app > Settings > iMessage.

  3. The first time BlueBubbles tries to send, macOS will ask
     "Allow BlueBubbles to control System Events / Messages" —
     click Allow.

After step 1, quit and relaunch BlueBubbles (or run this script
again — it's safe to re-run) for the permission to take effect.
Then run `pnpm bluebubbles:start` to bring up BlueBubbles + Corgi
together.
============================================================
EOF

open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

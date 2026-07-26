import 'dotenv/config'
import { execSync, spawn } from 'node:child_process'

// One-command dev entrypoint: ensures the locally-installed BlueBubbles
// Server is up (launching it if needed), then starts Corgi's dev server.
// BlueBubbles Server itself is a persistent macOS background app, not
// something this process owns the lifecycle of — stopping this script
// (Ctrl+C) stops Corgi, not BlueBubbles, matching how a real deployment
// would run (BlueBubbles auto-started at login, Corgi started/stopped
// independently). See scripts/bluebubbles-install.sh for one-time setup.

const SERVER_URL = process.env['BLUEBUBBLES_SERVER_URL'] ?? 'http://127.0.0.1:1234'
const SERVER_PASSWORD = process.env['BLUEBUBBLES_SERVER_PASSWORD']
const MAX_WAIT_MS = 30_000
const POLL_INTERVAL_MS = 1_000

async function isBlueBubblesRunning(): Promise<boolean> {
  if (SERVER_PASSWORD === undefined || SERVER_PASSWORD.length === 0) {
    return false
  }
  const url = new URL('/api/v1/ping', SERVER_URL)
  url.searchParams.set('password', SERVER_PASSWORD)
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

async function ensureBlueBubblesRunning(): Promise<void> {
  if (await isBlueBubblesRunning()) {
    console.log(`[bluebubbles] server already responding at ${SERVER_URL}`)
    return
  }

  console.log('[bluebubbles] launching BlueBubbles.app...')
  try {
    execSync('open -a /Applications/BlueBubbles.app')
  } catch {
    console.error(
      '[bluebubbles] could not launch /Applications/BlueBubbles.app — is it installed? ' +
        'Run scripts/bluebubbles-install.sh first.',
    )
    return
  }

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    if (await isBlueBubblesRunning()) {
      console.log('[bluebubbles] server is up.')
      return
    }
  }

  console.warn(
    `[bluebubbles] server did not respond within ${String(MAX_WAIT_MS / 1_000)}s.\n` +
      'If this is the first run, open BlueBubbles.app manually and complete the setup wizard —\n' +
      'Full Disk Access and iMessage sign-in are required and cannot be scripted.\n' +
      'Continuing to start Corgi anyway; the transport will retry once BlueBubbles is reachable.',
  )
}

await ensureBlueBubblesRunning()

console.log('[bluebubbles] starting Corgi dev server...')
const child = spawn('npx', ['tsx', 'watch', 'src/server.ts'], { stdio: 'inherit' })
child.on('exit', (code) => {
  process.exit(code ?? 0)
})

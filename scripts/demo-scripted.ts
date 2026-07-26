import 'dotenv/config'
import { createBlueBubblesClient } from '../src/transport/BlueBubblesClient.js'
import { BlueBubblesOutboundAdapter } from '../src/transport/BlueBubblesOutboundAdapter.js'

// Fully hardcoded, no-Claude, no-API-key-needed demo: sends a scripted
// buildup -> proposal -> pushback -> revised proposal -> acceptance ->
// confirmation sequence via real BlueBubbles, with randomized (never
// identical) gaps between lines so it doesn't read as computer-timed.
// Edit LINES below to reword before running. Requires only
// BLUEBUBBLES_SERVER_URL/PASSWORD + DEMO_GROUP_CHAT_GUID in .env (same as
// persona-relay.ts — see its header for how to find the chat GUID).
//
// Run: pnpm demo:scripted

function requireEnv(name: string, hint: string): string {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} not set — ${hint}`)
  return value
}

const serverUrl = process.env['BLUEBUBBLES_SERVER_URL'] ?? 'http://127.0.0.1:1234'
const password = requireEnv('BLUEBUBBLES_SERVER_PASSWORD', 'see .env.example')
const groupChatGuid = requireEnv(
  'DEMO_GROUP_CHAT_GUID',
  "set it in .env to the real group chat GUID (see persona-relay.ts's header for how to find it).",
)

const client = createBlueBubblesClient({ server_url: serverUrl, password })
const outbound = new BlueBubblesOutboundAdapter({ client })

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitter(baseMs: number, spreadMs: number): number {
  return baseMs + Math.random() * spreadMs
}

// [gap-before-base-ms, gap-before-spread-ms, text] — the gap before each
// line varies every run, never a fixed interval.
const LINES: Array<[number, number, string]> = [
  [0, 0, "ok we should actually do something this weekend, who's free"],
  [3_000, 6_000, 'yeah im down, just not too expensive lol'],
  [8_000, 10_000, 'same tbh this month has been rough'],
  [2_000, 4_000, 'been wanting to try bouldering for a while ngl'],
  [
    15_000,
    10_000,
    "ooh ok what about The Bouldering Project sat around 3pm? a couple of you mentioned wanting to get back into climbing and it's pretty low-key on cost",
  ],
  [5_000, 8_000, 'hard pass that place is kinda pricey ngl'],
  [4_000, 6_000, 'yeah fr, need something cheaper'],
  [
    10_000,
    8_000,
    'how about a board game cafe instead, sat at 4? way easier on the wallet and still a fun group hang',
  ],
  [3_000, 5_000, 'omg yes that works'],
  [2_000, 4_000, 'yeah im down!!'],
  [6_000, 6_000, '🎉 locked in! board game cafe sat at 4. see you all there'],
]

async function main(): Promise<void> {
  for (const [gapBase, gapSpread, text] of LINES) {
    await sleep(jitter(gapBase, gapSpread))
    await outbound.sendMessage({ groupId: groupChatGuid, text })
    console.log(`[demo-scripted] sent: ${text}`)
  }
  console.log('[demo-scripted] done.')
}

await main()

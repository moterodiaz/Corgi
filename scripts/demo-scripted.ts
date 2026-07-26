import 'dotenv/config'
import { io, type Socket } from 'socket.io-client'
import { createBlueBubblesClient } from '../src/transport/BlueBubblesClient.js'
import { BlueBubblesOutboundAdapter } from '../src/transport/BlueBubblesOutboundAdapter.js'
import { NEW_MESSAGE_EVENT } from '../src/transport/BlueBubblesInboundAdapter.js'

// Fully hardcoded, no-Claude, no-API-key-needed demo: waits for a message
// starting with "friend group" from anyone (same trigger as
// bluebubbles-trigger-test.ts, same reason for bypassing isFromMe — a
// trigger sent from the operator's own signed-in device is isFromMe:true
// too), then sends this machine's slice of a scripted buildup -> proposal
// -> pushback -> revised proposal -> acceptance -> confirmation sequence,
// with randomized (never identical) gaps between lines.
//
// Run the SAME repo on each of the 3 machines in the demo, each with a
// different DEMO_ROLE (0, 1, 2) in .env. Turn-taking is driven by actually
// counting real messages observed in the chat (one shared socket
// connection, from trigger onward) rather than each machine timing lines
// independently — independent local timers on 3 separate machines would
// drift apart and could send lines out of the intended order. Edit LINES
// to reword before running. Requires BLUEBUBBLES_SERVER_URL/PASSWORD in
// .env.
//
// Run: pnpm demo:scripted

const TRIGGER = 'friend group'

function requireEnv(name: string, hint: string): string {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} not set — ${hint}`)
  return value
}

const serverUrl = process.env['BLUEBUBBLES_SERVER_URL'] ?? 'http://127.0.0.1:1234'
const password = requireEnv('BLUEBUBBLES_SERVER_PASSWORD', 'see .env.example')
const role = Number(process.env['DEMO_ROLE'] ?? '0') % 3

const client = createBlueBubblesClient({ server_url: serverUrl, password })
const outbound = new BlueBubblesOutboundAdapter({ client })

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function extractChatGuid(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const payload = raw as { chats?: unknown }
  const chats = Array.isArray(payload.chats) ? payload.chats : undefined
  const firstChat = chats?.[0] as { guid?: unknown } | undefined
  return isNonEmptyString(firstChat?.guid) ? firstChat.guid : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitter(baseMs: number, spreadMs: number): number {
  return baseMs + Math.random() * spreadMs
}

// [role (0/1/2 — which machine sends this line), gap-before-base-ms,
// gap-before-spread-ms, text]. Gaps vary every run, never a fixed interval.
// Role 0 is the one whose device sends the "friend group" trigger (it also
// proposes/confirms); roles 1 and 2 are the other two machines.
const LINES: Array<[number, number, number, string]> = [
  [0, 0, 0, "ok we should actually do something this weekend, who's free"],
  [1, 3_000, 6_000, 'yeah im down, just not too expensive lol'],
  [2, 8_000, 10_000, 'same tbh this month has been rough'],
  [1, 2_000, 4_000, 'been wanting to try bouldering for a while ngl'],
  [
    0,
    15_000,
    10_000,
    "ooh ok what about The Bouldering Project sat around 3pm? a couple of you mentioned wanting to get back into climbing and it's pretty low-key on cost",
  ],
  [2, 5_000, 8_000, 'hard pass that place is kinda pricey ngl'],
  [1, 4_000, 6_000, 'yeah fr, need something cheaper'],
  [
    0,
    10_000,
    8_000,
    'how about a board game cafe instead, sat at 4? way easier on the wallet and still a fun group hang',
  ],
  [1, 3_000, 5_000, 'omg yes that works'],
  [2, 2_000, 4_000, 'yeah im down!!'],
  [0, 6_000, 6_000, '🎉 locked in! board game cafe sat at 4. see you all there'],
]

async function main(): Promise<void> {
  const socket: Socket = io(serverUrl, { query: { password } })
  socket.on('connect_error', (error: unknown) => {
    console.error(`[demo-scripted:role${role}] connect_error`, error)
  })

  let groupChatGuid: string | undefined
  let index = 0
  let sending = false

  async function maybeSendTurn(): Promise<void> {
    if (sending || groupChatGuid === undefined || index >= LINES.length) return
    const line = LINES[index]
    if (line === undefined || line[0] !== role) return
    sending = true
    const [, gapBase, gapSpread, text] = line
    await sleep(jitter(gapBase, gapSpread))
    await outbound.sendMessage({ groupId: groupChatGuid, text })
    console.log(`[demo-scripted:role${role}] sent: ${text}`)
    sending = false
  }

  socket.on(NEW_MESSAGE_EVENT, (raw: unknown) => {
    const chatGuid = extractChatGuid(raw)
    if (chatGuid === undefined) return

    if (groupChatGuid === undefined) {
      const payload = raw as { text?: unknown }
      const text = isNonEmptyString(payload.text) ? payload.text : undefined
      if (text === undefined || !text.trim().toLowerCase().startsWith(TRIGGER)) return
      groupChatGuid = chatGuid
      console.log(`[demo-scripted:role${role}] triggered — sending in chat ${groupChatGuid}`)
      void maybeSendTurn()
      return
    }

    if (chatGuid !== groupChatGuid) return
    index += 1
    void maybeSendTurn()
  })

  console.log(
    `[demo-scripted:role${role}] listening on ${serverUrl} — waiting for a message starting with "${TRIGGER}"...`,
  )
}

await main()

import 'dotenv/config'
import { io, type Socket } from 'socket.io-client'
import { createBlueBubblesClient } from '../src/transport/BlueBubblesClient.js'
import { BlueBubblesOutboundAdapter } from '../src/transport/BlueBubblesOutboundAdapter.js'
import { NEW_MESSAGE_EVENT } from '../src/transport/BlueBubblesInboundAdapter.js'

// Fully hardcoded, no-Claude, no-API-key-needed demo. Run the exact same
// command on all 3 machines — NO manual role/number config needed:
//
// - Whoever's device actually sends the "friend group" trigger message
//   (from anyone, any chat this Mac's iMessage can see — bypassing isFromMe
//   for trigger detection just like bluebubbles-trigger-test.ts, since the
//   trigger-sender's own device sees isFromMe:true for it) is auto-detected
//   as the "starter" and owns the role-0 lines (kickoff/proposal/confirm).
// - The other two machines don't know or need distinct identities: for
//   every "someone else" line, both race it with a randomized delay and
//   whichever actually observes it's still their turn (via the shared
//   chat's real message count — not each machine's own clock) sends it;
//   the other sees the turn already advanced and moves on. A machine that
//   just won backs off extra hard on the next "someone else" turn so the
//   same device doesn't dominate every line.
//
// This is deliberately eventually-consistent, not perfectly race-free —
// acceptable for a live demo, not something to build production infra on.
//
// Run: pnpm demo:scripted

const TRIGGER = 'friend group'
const OTHER_ROLE_HANDICAP_MS = 6_000
// If no other machine claims an "other participant" line within this long,
// the starter's own machine sends it instead — so the demo still completes
// solo (e.g. while testing, or if a friend's machine never came online)
// instead of stalling forever waiting for a participant that isn't there.
// Real other machines finish their normal jitter well before this elapses.
const SOLO_FALLBACK_DELAY_MS = 20_000

function requireEnv(name: string, hint: string): string {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} not set — ${hint}`)
  return value
}

const serverUrl = process.env['BLUEBUBBLES_SERVER_URL'] ?? 'http://127.0.0.1:1234'
const password = requireEnv('BLUEBUBBLES_SERVER_PASSWORD', 'see .env.example')

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

// [role (0 = the trigger-sender's device only; 1 = raced by every other
// device), gap-before-base-ms, gap-before-spread-ms, text]. Gaps vary every
// run, never a fixed interval.
const LINES: Array<[number, number, number, string]> = [
  [0, 0, 0, "ok we should actually do something this weekend, who's free"],
  [1, 3_000, 6_000, 'yeah im down, just not too expensive lol'],
  [1, 8_000, 10_000, 'same tbh this month has been rough'],
  [1, 2_000, 4_000, 'been wanting to try bouldering for a while ngl'],
  [
    0,
    15_000,
    10_000,
    "ooh ok what about The Bouldering Project sat around 3pm? a couple of you mentioned wanting to get back into climbing and it's pretty low-key on cost",
  ],
  [1, 5_000, 8_000, 'hard pass that place is kinda pricey ngl'],
  [1, 4_000, 6_000, 'yeah fr, need something cheaper'],
  [
    0,
    10_000,
    8_000,
    'how about a board game cafe instead, sat at 4? way easier on the wallet and still a fun group hang',
  ],
  [1, 3_000, 5_000, 'omg yes that works'],
  [1, 2_000, 4_000, 'yeah im down!!'],
  [0, 6_000, 6_000, '🎉 locked in! board game cafe sat at 4. see you all there'],
]

async function main(): Promise<void> {
  const socket: Socket = io(serverUrl, { query: { password } })
  socket.on('connect_error', (error: unknown) => {
    console.error('[demo-scripted] connect_error', error)
  })

  let groupChatGuid: string | undefined
  let amITriggerSender: boolean | undefined
  let index = 0
  let sending = false
  let lastTurnWonByMe = false

  async function maybeSendTurn(): Promise<void> {
    if (sending || groupChatGuid === undefined || amITriggerSender === undefined) return
    if (index >= LINES.length) return
    const line = LINES[index]
    if (line === undefined) return
    const [lineRole, gapBase, gapSpread, text] = line
    if (lineRole === 0 && !amITriggerSender) return // role-0 lines are exclusive to the trigger sender

    sending = true
    const startIndex = index
    let handicap = 0
    if (lineRole !== 0) {
      if (lastTurnWonByMe) handicap += OTHER_ROLE_HANDICAP_MS + Math.random() * 8_000
      // The starter defers to real "other" participants if any exist, but
      // will pick up the line itself if nobody else claims it in time.
      if (amITriggerSender) handicap += SOLO_FALLBACK_DELAY_MS
    }
    await sleep(jitter(gapBase, gapSpread) + handicap)

    // Someone else may already have sent this turn while we waited.
    if (index !== startIndex) {
      sending = false
      return
    }
    await outbound.sendMessage({ groupId: groupChatGuid, text })
    lastTurnWonByMe = lineRole !== 0
    console.log(`[demo-scripted] sent: ${text}`)
    sending = false
  }

  socket.on(NEW_MESSAGE_EVENT, (raw: unknown) => {
    const chatGuid = extractChatGuid(raw)
    if (chatGuid === undefined) return

    if (groupChatGuid === undefined) {
      const payload = raw as { text?: unknown; isFromMe?: unknown }
      const text = isNonEmptyString(payload.text) ? payload.text : undefined
      if (text === undefined || !text.trim().toLowerCase().startsWith(TRIGGER)) return
      groupChatGuid = chatGuid
      amITriggerSender = payload.isFromMe === true
      console.log(
        `[demo-scripted] triggered in chat ${groupChatGuid} — I am ${amITriggerSender ? 'the starter (role 0)' : 'another participant'}`,
      )
      void maybeSendTurn()
      return
    }

    if (chatGuid !== groupChatGuid) return
    index += 1
    void maybeSendTurn()
  })

  console.log(
    `[demo-scripted] listening on ${serverUrl} — waiting for a message starting with "${TRIGGER}"...`,
  )
}

await main()

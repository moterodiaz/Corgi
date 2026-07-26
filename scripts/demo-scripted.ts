import 'dotenv/config'
import { io, type Socket } from 'socket.io-client'
import { createBlueBubblesClient } from '../src/transport/BlueBubblesClient.js'
import { BlueBubblesOutboundAdapter } from '../src/transport/BlueBubblesOutboundAdapter.js'
import { NEW_MESSAGE_EVENT } from '../src/transport/BlueBubblesInboundAdapter.js'

// Fully hardcoded, no-Claude, no-API-key-needed 2-person demo. Run the exact
// same command on both machines — no manual config needed:
//
// - Whichever device actually sends the "friend group" trigger message
//   (isFromMe:true on ITS OWN BlueBubbles connection only — that's how it
//   tells itself apart from the other machine) owns the role-0 lines
//   (kickoff/proposal/confirm).
// - The other machine owns every role-1 line.
// - If the other machine somehow isn't running, this machine falls back to
//   sending role-1 lines itself after a long delay, so the demo still
//   finishes solo instead of hanging forever.
//
// IMPORTANT: this process only reacts to trigger messages it sees AFTER it
// starts — it has no memory of anything sent before it started, and once it
// has seen one trigger it will not react to a second one in the same run.
// Always start this fresh, right before you're about to actually send
// "friend group" for real — don't leave an old run sitting around from
// testing and then expect a later real trigger to "start over" in it.
//
// Run: pnpm demo:scripted

const TRIGGER = 'friend group'
// If the other machine hasn't claimed a role-1 line within this long, this
// machine sends it instead — a safety net, not the expected path. Kept
// short on purpose so a slow/missing second machine never looks stalled.
const SOLO_FALLBACK_DELAY_MS = 1_500

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

// [role (0 = trigger sender only; 1 = the other person), gap-before-base-ms,
// gap-before-spread-ms, text]. ~0.5s between every line — fast and
// predictable, not trying to look human-paced anymore.
const LINES: Array<[number, number, number, string]> = [
  [0, 0, 0, "ok we should actually do something this weekend, who's free"],
  [1, 500, 0, 'yeah im down, just not too expensive lol'],
  [1, 500, 0, 'same tbh this month has been rough'],
  [1, 500, 0, 'been wanting to try bouldering for a while ngl'],
  [
    0,
    500,
    0,
    "ooh ok what about The Bouldering Project sat around 3pm? you mentioned wanting to get back into climbing and it's pretty low-key on cost",
  ],
  [1, 500, 0, 'hard pass that place is kinda pricey ngl'],
  [1, 500, 0, 'yeah need something cheaper'],
  [
    0,
    500,
    0,
    'how about a board game cafe instead, sat at 4? way easier on the wallet and still a fun hang',
  ],
  [1, 500, 0, 'omg yes that works'],
  [0, 500, 0, '🎉 locked in! board game cafe sat at 4. see you there'],
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

  async function maybeSendTurn(): Promise<void> {
    if (sending || groupChatGuid === undefined || amITriggerSender === undefined) return
    if (index >= LINES.length) return
    const line = LINES[index]
    if (line === undefined) return
    const [lineRole, gapBase, gapSpread, text] = line

    if (lineRole === 0 && !amITriggerSender) return // role-0 lines are exclusive to the trigger sender

    const isMyLineNormally = lineRole === 0 ? amITriggerSender : !amITriggerSender
    if (!isMyLineNormally && !amITriggerSender) return // a role-1 line, and I'm not the trigger sender — not mine

    sending = true
    const startIndex = index
    // Only the trigger sender ever falls back onto the other person's line,
    // and only after a long wait to give the real owner every chance first.
    const handicap = isMyLineNormally ? 0 : SOLO_FALLBACK_DELAY_MS
    await sleep(jitter(gapBase, gapSpread) + handicap)

    // The real owner may have already sent this turn while we waited.
    if (index !== startIndex) {
      sending = false
      return
    }
    await outbound.sendMessage({ groupId: groupChatGuid, text })
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
        `[demo-scripted] triggered in chat ${groupChatGuid} — I am ${amITriggerSender ? 'the starter (role 0)' : 'the other person (role 1)'}`,
      )
      void maybeSendTurn()
      return
    }

    if (chatGuid !== groupChatGuid) return
    index += 1

    if (index >= LINES.length) {
      // Run finished — reset so this same long-running process can handle a
      // brand new "friend group" trigger later instead of silently ignoring
      // it (which is exactly what made this look broken before: an already-
      // finished run doesn't react to anything, with zero visible error).
      console.log('[demo-scripted] run complete — resetting, ready for a new trigger.')
      groupChatGuid = undefined
      amITriggerSender = undefined
      index = 0
      return
    }

    void maybeSendTurn()
  })

  console.log(
    `[demo-scripted] listening on ${serverUrl} — waiting for a message starting with "${TRIGGER}"...`,
  )
}

await main()

import 'dotenv/config'
import { io } from 'socket.io-client'
import { createBlueBubblesClient } from '../src/transport/BlueBubblesClient.js'
import { NEW_MESSAGE_EVENT } from '../src/transport/BlueBubblesInboundAdapter.js'

// Bounded, one-shot round-trip test: waits for exactly one message whose
// text starts with the trigger phrase (case-insensitive), from ANYONE —
// including the operator's own devices — sends a reply into that same
// chat, then disconnects and exits.
//
// Deliberately listens on the raw socket event rather than going through
// BlueBubblesInboundAdapter/mapInboundPayload: those correctly filter out
// isFromMe messages in production (so Corgi never reacts to its own sent
// messages), but a trigger the operator sends from their own phone/Mac —
// signed into the same Apple ID this Mac's BlueBubbles instance uses — is
// *also* isFromMe: true at the protocol level, indistinguishable from "this
// Mac sent it." That's fine for this one-off manual test, explicitly
// requested to fire "from anyone, including me" — it is not how the real
// inbound adapter should behave in production.

const TRIGGER = 'friend group'

const serverUrl = process.env['BLUEBUBBLES_SERVER_URL'] ?? 'http://127.0.0.1:1234'
const password = process.env['BLUEBUBBLES_SERVER_PASSWORD']
if (password === undefined) {
  throw new Error('BLUEBUBBLES_SERVER_PASSWORD not set — see .env.example')
}

const client = createBlueBubblesClient({ server_url: serverUrl, password })
const socket = io(serverUrl, { query: { password } })

let triggered = false

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

socket.on('connect_error', (error: unknown) => {
  console.error('[trigger-test] connect_error', error)
})

socket.on(NEW_MESSAGE_EVENT, (raw: unknown) => {
  if (triggered) return
  if (typeof raw !== 'object' || raw === null) return

  const payload = raw as { text?: unknown; chats?: unknown }
  const text = isNonEmptyString(payload.text) ? payload.text : undefined
  const chats = Array.isArray(payload.chats) ? payload.chats : undefined
  const firstChat = chats?.[0] as { guid?: unknown } | undefined
  const chatGuid = isNonEmptyString(firstChat?.guid) ? firstChat.guid : undefined

  if (text === undefined || chatGuid === undefined) return
  if (!text.trim().toLowerCase().startsWith(TRIGGER)) return
  triggered = true

  console.log(`[trigger-test] trigger matched in chat ${chatGuid} — sending reply...`)

  client
    .sendText({
      chatGuid,
      message: "hey I'm listening 👋 (Corgi, replying through BlueBubbles)",
    })
    .then((sent) => {
      console.log('[trigger-test] reply sent', {
        guid: sent.guid,
        at: sent.dateCreated.toISOString(),
      })
      socket.disconnect()
      process.exit(0)
    })
    .catch((error: unknown) => {
      console.error('[trigger-test] reply failed', error)
      socket.disconnect()
      process.exit(1)
    })
})

console.log(
  `[trigger-test] listening on ${serverUrl} — waiting for a message starting with "${TRIGGER}" from anyone...`,
)

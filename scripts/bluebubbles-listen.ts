import 'dotenv/config'
import { BlueBubblesInboundAdapter } from '../src/transport/BlueBubblesInboundAdapter.js'

// Standalone smoke-test utility: connects to the locally-running BlueBubbles
// Server and logs every real inbound message/reaction it receives. Useful
// for verifying a fresh install actually has Full Disk Access + iMessage
// sign-in working end-to-end, independent of the full Corgi server.

const serverUrl = process.env['BLUEBUBBLES_SERVER_URL'] ?? 'http://127.0.0.1:1234'
const password = process.env['BLUEBUBBLES_SERVER_PASSWORD']
if (password === undefined) {
  throw new Error('BLUEBUBBLES_SERVER_PASSWORD not set — see .env.example')
}

const adapter = new BlueBubblesInboundAdapter({
  server_url: serverUrl,
  password,
  onConnectionIssue: (issue) => {
    console.log(`[bluebubbles-listen] connection issue: ${issue.type}`, issue.detail)
  },
})

adapter.onMessage((message) => {
  console.log('[bluebubbles-listen] MESSAGE', {
    from: message.senderId,
    chat: message.groupId,
    text: message.text,
    at: message.receivedAt.toISOString(),
  })
})

adapter.onCardInteraction((interaction) => {
  console.log('[bluebubbles-listen] REACTION', {
    from: interaction.senderId,
    chat: interaction.groupId,
    action: interaction.action,
    at: interaction.receivedAt.toISOString(),
  })
})

adapter.connect()
console.log(
  `[bluebubbles-listen] listening on ${serverUrl} — send any text or tapback to any chat.`,
)

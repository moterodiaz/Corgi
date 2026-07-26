import 'dotenv/config'
import { decideNextLine, type PersonaProfile } from '../src/demo/persona-chat.js'
import { BlueBubblesInboundAdapter } from '../src/transport/BlueBubblesInboundAdapter.js'
import { BlueBubblesOutboundAdapter } from '../src/transport/BlueBubblesOutboundAdapter.js'
import { createBlueBubblesClient } from '../src/transport/BlueBubblesClient.js'
import { type TranscriptEntry } from '../src/types/transcript.js'

// Runs on ONE person's own Mac during the live multi-device demo, watching
// the real shared group chat through THIS Mac's own local BlueBubbles
// Server and speaking as ONE specific person in it. Every other participant
// (including the organizer's "AK" persona and the real Corgi bot) runs the
// exact same script — or the real bot — independently on their OWN Mac.
// There is deliberately no networking or shared state between these
// processes: the group chat itself, observed independently by each Mac's
// own BlueBubbles connection, is the only channel. This mirrors exactly how
// a group of real humans texting from separate phones actually works, and
// is required so timing stays honest (see decideNextLine's doc comment) —
// nobody's persona can ever see a line before it has actually been sent.
//
// Setup (per machine):
//   1. pnpm bluebubbles:install && pnpm bluebubbles:start (this Mac needs
//      its OWN Full-Disk-Access-granted, iMessage-signed-in BlueBubbles —
//      see README's BlueBubbles setup section).
//   2. Add this Mac's iMessage number to the real group chat like any person.
//   3. Set DEMO_GROUP_CHAT_GUID in .env to the chat's GUID (see below for
//      how to find it) — the SAME value on every machine in the demo.
//   4. Edit the PERSONA block below: name, a real sample of how this person
//      actually texts (for style calibration only — never quoted verbatim),
//      and a few loose topics this person might organically bring up.
//   5. pnpm demo:persona-relay
//
// Finding the chat GUID: run `pnpm bluebubbles:listen`, send any message
// into the target group chat from any device in it, and copy the `chat`
// field it logs.

const PERSONA: PersonaProfile = {
  name: 'REPLACE_WITH_YOUR_NAME',
  textingStyleSample: `
paste a real sample of your own texts here before running this —
a handful of real messages is enough, it's only used to calibrate
tone/rhythm/slang, never quoted verbatim
`.trim(),
  topics: ['a loose thing you might organically bring up — a vibe, not a script'],
}

function requireEnv(name: string, hint: string): string {
  const value = process.env[name]
  if (value === undefined) throw new Error(`${name} not set — ${hint}`)
  return value
}

const serverUrl = process.env['BLUEBUBBLES_SERVER_URL'] ?? 'http://127.0.0.1:1234'
const password = requireEnv('BLUEBUBBLES_SERVER_PASSWORD', 'see .env.example')
const groupChatGuid = requireEnv(
  'DEMO_GROUP_CHAT_GUID',
  "set it in .env to the real group chat GUID (see this file's header for how to find it).",
)

if (PERSONA.name === 'REPLACE_WITH_YOUR_NAME') {
  throw new Error(
    'Edit the PERSONA block in scripts/persona-relay.ts before running — it still has placeholder values.',
  )
}

const client = createBlueBubblesClient({ server_url: serverUrl, password })
const outbound = new BlueBubblesOutboundAdapter({ client })
const inbound = new BlueBubblesInboundAdapter({
  server_url: serverUrl,
  password,
  onConnectionIssue: (issue) => {
    console.log(`[persona-relay:${PERSONA.name}] connection issue: ${issue.type}`, issue.detail)
  },
})

// This Mac's own view of the conversation, rebuilt purely from what it has
// actually observed arrive over its own connection — never shared with, or
// read from, any other machine.
const transcript: TranscriptEntry[] = []
let nextTopicIndex = 0
// Debounces bursts of several inbound messages arriving while this persona
// is still "reading" — decide once against the latest transcript rather
// than firing one overlapping decision per message.
let deciding = false
let pendingDecision = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function humanReadDelayMs(): number {
  // Real people don't reply instantly, and don't all reply at the exact
  // same measured interval — a wide, randomized window reads far more
  // human than a fixed pause would.
  return 4_000 + Math.random() * 20_000
}

async function maybeRespond(): Promise<void> {
  if (deciding) {
    pendingDecision = true
    return
  }
  deciding = true
  try {
    await sleep(humanReadDelayMs())

    const decision = await decideNextLine({
      persona: PERSONA,
      transcript: [...transcript],
      nextTopicIndex,
      isClosingStretch: false,
    })

    if (decision.should_speak && decision.text !== undefined) {
      const lines = decision.text.split('\n').filter((line) => line.trim().length > 0)
      for (const [index, line] of lines.entries()) {
        await outbound.sendMessage({ groupId: groupChatGuid, text: line })
        transcript.push({
          groupId: groupChatGuid,
          sender: PERSONA.name,
          text: line,
          timestamp: new Date().toISOString(),
        })
        console.log(`[persona-relay:${PERSONA.name}] sent: ${line}`)
        if (index < lines.length - 1) await sleep(700 + Math.random() * 1_400)
      }
      if (nextTopicIndex < PERSONA.topics.length - 1) nextTopicIndex += 1
    }
  } catch (error) {
    console.error(`[persona-relay:${PERSONA.name}] failed to decide/send`, error)
  } finally {
    deciding = false
    if (pendingDecision) {
      pendingDecision = false
      await maybeRespond()
    }
  }
}

inbound.onMessage((message) => {
  if (message.groupId !== groupChatGuid) return // a different chat on this Mac — not part of the demo

  transcript.push({
    groupId: message.groupId,
    sender: message.senderId,
    text: message.text,
    timestamp: message.receivedAt.toISOString(),
  })
  console.log(`[persona-relay:${PERSONA.name}] observed [${message.senderId}]: ${message.text}`)

  void maybeRespond()
})

inbound.connect()
console.log(
  `[persona-relay:${PERSONA.name}] watching chat ${groupChatGuid} on ${serverUrl} — waiting for the conversation to start.`,
)

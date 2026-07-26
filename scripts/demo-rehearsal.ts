import 'dotenv/config'
import { extractContext } from '../src/claude/context-extraction.js'
import { decideNextLine, type PersonaProfile } from '../src/demo/persona-chat.js'
import {
  HangoutOrchestrator,
  type HangoutOrchestratorOutbound,
} from '../src/orchestrator/hangout-orchestrator.js'
import { appendTranscriptEntry, getTranscriptByGroup } from '../src/store/transcript-repo.js'
import { type TransportInboundMessage } from '../src/transport/TransportPort.js'

// Runs the ENTIRE demo script (buildup chat -> propose -> pushback ->
// revise -> confirm) on this one machine, with no real iMessages sent, so
// the conversation pacing/style and the real bot pipeline can both be
// verified before the live multi-device event. Every persona line and
// every bot reply goes through the exact same code the live demo uses
// (persona-chat.ts's decideNextLine, HangoutOrchestrator) — only the
// transport is swapped for a console-logging stub.
//
// Run: pnpm demo:rehearsal
// (Requires a real ANTHROPIC_API_KEY in .env — this makes real Claude
// calls, same as the live bot would.)

const GROUP_ID = `demo-rehearsal-${String(Date.now())}`

// Replace this with a real sample of your own texts (see README's Demo
// section) — this is what calibrates the "AK" persona's voice. Kept short
// here on purpose; paste in more of your own texting history for a better
// match closer to the real event.
const AK_STYLE_SAMPLE = `
the one that doesn't move at hte start?
i feel like people would do either that or like a tipping point robot
wait actually just a tipping point robot
13 years ago is wild lmfao
wait they didn't have object limit
also does it can hold mean it counts towards points
like what im seeing is some people towered above where the bar ended
idk how to explain
lmfao remember the crappy ass drawings from last summer
also do you have insta?
`.trim()

const FRIEND_STYLE_SAMPLE = `
lol yeah fr
wait no way
omg stoppp
i'm so tired rn
ok but actually
lmaooo true
wait fr??
nah i can't
`.trim()

const AK: PersonaProfile = {
  name: 'AK',
  textingStyleSample: AK_STYLE_SAMPLE,
  topics: [
    'swamped with a project/deadline this week, barely any free time',
    "hasn't seen everyone in a while, mentions missing hanging out",
  ],
}

const FRIEND: PersonaProfile = {
  name: 'Florida',
  textingStyleSample: FRIEND_STYLE_SAMPLE,
  topics: [
    'kind of broke this month, budget is tight',
    'has been wanting to try bouldering/climbing for a while',
    'suggests we should actually hang out soon',
  ],
}

const PERSONAS = [AK, FRIEND]

// Simulated historical timestamps for the buildup — a "day 1" burst, a gap,
// a "day 2" burst — so the transcript reads as ~2 days old without needing
// real wall-clock time to pass. The live trigger + everything after happens
// at real "now".
const now = Date.now()
const DAY_MS = 24 * 60 * 60 * 1_000
const HISTORICAL_TIMESTAMPS = [
  now - 2 * DAY_MS + 0,
  now - 2 * DAY_MS + 3 * 60_000,
  now - 2 * DAY_MS + 6 * 60_000,
  now - 2 * DAY_MS + 9 * 60_000,
  now - 1.4 * DAY_MS,
  now - 1.4 * DAY_MS + 2 * 60_000,
  now - 1.4 * DAY_MS + 5 * 60_000,
  now - 0.9 * DAY_MS,
  now - 0.9 * DAY_MS + 4 * 60_000,
  now - 0.9 * DAY_MS + 7 * 60_000,
  now - 0.9 * DAY_MS + 8 * 60_000,
  now - 0.2 * DAY_MS,
  now - 0.2 * DAY_MS + 3 * 60_000,
  now - 0.2 * DAY_MS + 6 * 60_000,
]

function logLine(sender: string, text: string): void {
  console.log(`  [${sender}] ${text}`)
}

async function runBuildup(): Promise<void> {
  console.log(`\n=== Buildup (group: ${GROUP_ID}) ===\n`)

  const topicProgress = new Map<string, number>(PERSONAS.map((p) => [p.name, 0]))
  let timestampIndex = 0

  for (let round = 0; round < HISTORICAL_TIMESTAMPS.length; round++) {
    // Alternate whose "turn" it plausibly is, but let either persona decide
    // to stay silent — real conversations aren't strict turn-taking.
    const persona = PERSONAS[round % PERSONAS.length]
    if (persona === undefined) continue

    const transcript = await getTranscriptByGroup(GROUP_ID)
    const nextTopicIndex = topicProgress.get(persona.name) ?? 0
    const isClosingStretch = round >= HISTORICAL_TIMESTAMPS.length - 4

    const decision = await decideNextLine({
      persona,
      transcript,
      nextTopicIndex,
      isClosingStretch,
    })

    if (!decision.should_speak || decision.text === undefined) continue

    const timestamp = HISTORICAL_TIMESTAMPS[timestampIndex] ?? now
    timestampIndex += 1

    for (const line of decision.text.split('\n').filter((l) => l.trim().length > 0)) {
      logLine(persona.name, line)
      await appendTranscriptEntry({
        groupId: GROUP_ID,
        sender: persona.name,
        text: line,
        timestamp: new Date(timestamp).toISOString(),
      })
    }

    if (nextTopicIndex < persona.topics.length - 1) {
      topicProgress.set(persona.name, nextTopicIndex + 1)
    }
  }
}

class LoggingTransport implements HangoutOrchestratorOutbound {
  async sendMessage(input: { groupId: string; text: string }): Promise<unknown> {
    console.log(`\n  [🤖 CORGI] ${input.text}\n`)
    return {
      messageId: `rehearsal-${String(Date.now())}`,
      groupId: input.groupId,
      text: input.text,
      sentAt: new Date(),
    }
  }
}

function inbound(sender: string, text: string): TransportInboundMessage {
  return {
    messageId: `rehearsal-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    groupId: GROUP_ID,
    senderId: sender,
    text,
    receivedAt: new Date(),
  }
}

async function runLiveMoment(orchestrator: HangoutOrchestrator): Promise<void> {
  console.log('\n=== Live moment: trigger, proposal, pushback, revision, confirmation ===\n')

  logLine('AK', "ok we should actually do something this weekend, who's free")
  await orchestrator.handleMessage(
    inbound('AK', "ok we should actually do something this weekend, who's free"),
  )

  logLine('Florida', "yeah i'm down, just not that expensive lol")
  await orchestrator.handleMessage(inbound('Florida', "yeah i'm down, just not that expensive lol"))

  // Give it a beat, then push back on whatever got proposed.
  await new Promise((resolve) => setTimeout(resolve, 500))
  logLine('AK', 'hard pass that place is way too pricey ngl')
  await orchestrator.handleMessage(inbound('AK', 'hard pass that place is way too pricey ngl'))

  await new Promise((resolve) => setTimeout(resolve, 500))
  logLine('Florida', 'yeah agreed, sounds good tho')
  await orchestrator.handleMessage(inbound('Florida', 'yeah agreed, sounds good tho'))

  await new Promise((resolve) => setTimeout(resolve, 500))
  logLine('AK', 'yeah works for me')
  await orchestrator.handleMessage(inbound('AK', 'yeah works for me'))
}

async function main(): Promise<void> {
  await runBuildup()

  // The buildup was injected straight into the transcript store, bypassing
  // the orchestrator entirely — so it never ran context extraction and
  // doesn't know either persona exists yet. Run extraction once now and
  // prime known-persons directly so the live moment starts with the same
  // profile signal a real 2-day-old group chat would already have.
  console.log('\n=== Extracting context from buildup ===\n')
  const personaNames = PERSONAS.map((p) => p.name)
  const buildupTranscript = await getTranscriptByGroup(GROUP_ID)
  await extractContext(buildupTranscript, GROUP_ID, personaNames)

  const orchestrator = new HangoutOrchestrator({ transport: new LoggingTransport() })
  orchestrator.primeKnownPersons(GROUP_ID, personaNames)
  await runLiveMoment(orchestrator)

  console.log('\n=== Rehearsal complete ===')
}

await main()

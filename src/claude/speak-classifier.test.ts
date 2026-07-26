import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureTranscript, FIXTURE_GROUP_ID } from '../../tests/fixtures/transcript.js'
import type { PersonProfile } from '../types/profile.js'
import type { TranscriptEntry } from '../types/transcript.js'
import { ClaudeClient } from './client.js'
import { CLASSIFIER_MODEL } from './models.js'
import { classifySpeakNow } from './speak-classifier.js'

type MockHandler = (request: IncomingMessage, response: ServerResponse) => void

let server: Server | undefined

afterEach(async () => {
  server?.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error === undefined ? resolve() : reject(error)))
  })
  server = undefined
})

async function startAnthropicMock(handler: MockHandler): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Mock Anthropic server did not expose a TCP address')
  }

  return `http://127.0.0.1:${address.port}`
}

function sendDecision(
  response: ServerResponse,
  decision: 'silent' | 'clarifying' | 'propose',
  reason: string,
): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: CLASSIFIER_MODEL,
      content: [
        {
          type: 'tool_use',
          id: 'toolu_test',
          name: 'submit_structured_output',
          input: { decision, reason },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  )
}

// ponytail: fixed timestamp avoids Date.now() non-determinism in profile fixtures
const FIXED_TS = 1753920000000

function makeProfile(personId: string, groupId: string): PersonProfile {
  return {
    person_id: personId,
    group_id: groupId,
    name: personId,
    interests: [{ activity: 'climbing', recency: FIXED_TS, confidence: 0.8, mention_count: 2 }],
    budget_signals: [],
    constraints: [],
    availability_mentions: [],
    updated_at: FIXED_TS,
  }
}

const THREE_PROFILES = ['sam', 'jess', 'alex'].map((id) => makeProfile(id, FIXTURE_GROUP_ID))

describe('classifySpeakNow', () => {
  it('serializes transcript into the request and returns propose on explicit planning language', async () => {
    let requestBody = ''
    const baseURL = await startAnthropicMock((request, response) => {
      request.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString()
      })
      request.on('end', () =>
        sendDecision(response, 'propose', 'explicit planning language detected'),
      )
    })

    // fixtureTranscript ends with "we should really hang out soon, it's been forever"
    const result = await classifySpeakNow({
      entries: fixtureTranscript,
      profiles: THREE_PROFILES,
      groupSize: 3,
      minutesSinceLastMessage: 15,
      client: new ClaudeClient({ baseURL }),
    })

    const prompt: string = JSON.parse(requestBody).messages[0].content
    // Transcript text must appear in the prompt — if serialization is removed, this fails.
    expect(prompt).toContain('we should really hang out soon')
    // The explicit-planning-language signal instruction must be present.
    expect(prompt).toContain('Explicit planning language')
    expect(result.decision).toBe('propose')
    expect(result.reason).toBe('explicit planning language detected')
  })

  it('encodes minutesSinceLastMessage in the request for the lull-after-planning signal', async () => {
    let requestBody = ''
    const baseURL = await startAnthropicMock((request, response) => {
      request.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString()
      })
      request.on('end', () => sendDecision(response, 'propose', 'lull after planning talk'))
    })

    const planningEntries: TranscriptEntry[] = [
      {
        sender: 'sam',
        text: 'what should we do this weekend?',
        timestamp: '2026-08-01T10:00:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
      {
        sender: 'jess',
        text: 'not sure, something outdoors maybe',
        timestamp: '2026-08-01T10:01:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
    ]

    const result = await classifySpeakNow({
      entries: planningEntries,
      profiles: THREE_PROFILES,
      groupSize: 3,
      minutesSinceLastMessage: 30,
      client: new ClaudeClient({ baseURL }),
    })

    const prompt: string = JSON.parse(requestBody).messages[0].content
    // Lull duration must be encoded — if minutesSinceLastMessage is dropped, this fails.
    expect(prompt).toContain('30 minutes')
    // The lull signal instruction must be present.
    expect(prompt).toContain('lull after planning-adjacent talk')
    expect(result.decision).toBe('propose')
  })

  it('encodes the unresolved-disagreement signal and returns silent', async () => {
    let requestBody = ''
    const baseURL = await startAnthropicMock((request, response) => {
      request.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString()
      })
      request.on('end', () => sendDecision(response, 'silent', 'active disagreement in chat'))
    })

    const conflictEntries: TranscriptEntry[] = [
      {
        sender: 'sam',
        text: "let's do the climbing gym",
        timestamp: '2026-08-01T11:00:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
      {
        sender: 'jess',
        text: 'no I hate that idea, stop pushing it',
        timestamp: '2026-08-01T11:01:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
      {
        sender: 'sam',
        text: 'fine, whatever',
        timestamp: '2026-08-01T11:02:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
    ]

    const result = await classifySpeakNow({
      entries: conflictEntries,
      profiles: THREE_PROFILES,
      groupSize: 3,
      minutesSinceLastMessage: 2,
      client: new ClaudeClient({ baseURL }),
    })

    const prompt: string = JSON.parse(requestBody).messages[0].content
    // Disagreement-signal instruction must be in the prompt.
    expect(prompt).toContain('unresolved disagreement')
    // The conflicting message must be serialized into the prompt.
    expect(prompt).toContain('stop pushing it')
    expect(result.decision).toBe('silent')
  })

  it('encodes profile coverage ratio and returns silent for insufficient coverage', async () => {
    let requestBody = ''
    const baseURL = await startAnthropicMock((request, response) => {
      request.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString()
      })
      request.on('end', () => sendDecision(response, 'silent', 'only 1 of 5 members profiled'))
    })

    // sam has interests; jess has a stored profile but no usable data yet — must not
    // count toward coverage. The remaining 3 group members have no profile at all.
    const unprofiledJess: PersonProfile = {
      person_id: 'jess',
      group_id: FIXTURE_GROUP_ID,
      name: 'jess',
      interests: [],
      budget_signals: [],
      constraints: [],
      availability_mentions: [],
      updated_at: FIXED_TS,
    }
    const sparseProfiles: PersonProfile[] = [makeProfile('sam', FIXTURE_GROUP_ID), unprofiledJess]

    const result = await classifySpeakNow({
      entries: fixtureTranscript,
      profiles: sparseProfiles,
      groupSize: 5,
      minutesSinceLastMessage: 5,
      client: new ClaudeClient({ baseURL }),
    })

    const prompt: string = JSON.parse(requestBody).messages[0].content
    // Coverage ratio must be rendered correctly — if profiledCount logic is broken, this fails.
    expect(prompt).toContain('1 of 5')
    // Insufficient-coverage signal instruction must be present.
    expect(prompt).toContain('Insufficient profile coverage')
    expect(result.decision).toBe('silent')
  })

  it('prompt contains the default-bias instruction — mutation check: removing it must make this test fail', async () => {
    // Ambiguous transcript: pure reminiscing, no planning language, no disagreement.
    let requestBody = ''
    const baseURL = await startAnthropicMock((request, response) => {
      request.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString()
      })
      request.on('end', () => sendDecision(response, 'silent', 'no clear signals present'))
    })

    const ambiguousEntries: TranscriptEntry[] = [
      {
        sender: 'sam',
        text: 'remember that time we went to the lake?',
        timestamp: '2026-08-01T12:00:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
      {
        sender: 'jess',
        text: 'haha yes that was so fun',
        timestamp: '2026-08-01T12:01:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
      {
        sender: 'alex',
        text: 'good times',
        timestamp: '2026-08-01T12:02:00Z',
        groupId: FIXTURE_GROUP_ID,
      },
    ]

    const result = await classifySpeakNow({
      entries: ambiguousEntries,
      profiles: THREE_PROFILES,
      groupSize: 3,
      minutesSinceLastMessage: 5,
      client: new ClaudeClient({ baseURL }),
    })

    const prompt: string = JSON.parse(requestBody).messages[0].content
    // These two assertions are the mutation check. Delete either line from buildPrompt and this test goes red.
    expect(prompt).toContain('wait longer than feels necessary')
    expect(prompt).toContain('When signals are ambiguous, return "silent"')
    expect(result.decision).toBe('silent')
  })
})

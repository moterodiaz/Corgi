import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../store/client.js'
import { getGroupProfile, getPersonProfile } from '../store/profile-repo.js'
import { fixtureTranscript } from '../../tests/fixtures/transcript.js'
import { ClaudeClient } from './client.js'
import { StructuredOutputError } from './structured-call.js'
import { REASONING_MODEL } from './models.js'
import {
  extractContext,
  shouldExtractContext,
  type ExtractionOutput,
  type ExtractionState,
} from './context-extraction.js'

// Isolated group ID — does not collide with 'test-group-profile' used by profile-repo.test.ts.
const GROUP = 'test-group-extraction'

type MockHandler = (request: IncomingMessage, response: ServerResponse) => void

// Module-level so afterEach inside the extractContext describe can always reach it.
let server: Server | undefined

async function startMock(handler: MockHandler): Promise<string> {
  server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Mock server did not expose a TCP address')
  }
  return `http://127.0.0.1:${address.port}`
}

function sendExtraction(response: ServerResponse, output: ExtractionOutput): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: REASONING_MODEL,
      content: [
        {
          type: 'tool_use',
          id: 'toolu_test',
          name: 'submit_structured_output',
          input: output,
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// shouldExtractContext — pure unit tests, no I/O
// ──────────────────────────────────────────────────────────────────────────────

describe('shouldExtractContext', () => {
  it('fires when message threshold is reached', () => {
    const state: ExtractionState = { messagesSinceLastExtraction: 10, msSinceLastExtraction: 0 }
    expect(
      shouldExtractContext(state, { messageThreshold: 10, timeThresholdMs: 999_999_999 }),
    ).toBe(true)
  })

  it('fires when time threshold is reached', () => {
    const state: ExtractionState = {
      messagesSinceLastExtraction: 0,
      msSinceLastExtraction: 7_200_000,
    }
    expect(shouldExtractContext(state, { messageThreshold: 999, timeThresholdMs: 7_200_000 })).toBe(
      true,
    )
  })

  it('does not fire when neither threshold is met', () => {
    const state: ExtractionState = {
      messagesSinceLastExtraction: 5,
      msSinceLastExtraction: 3_600_000,
    }
    expect(shouldExtractContext(state, { messageThreshold: 10, timeThresholdMs: 7_200_000 })).toBe(
      false,
    )
  })

  it('fires when both thresholds are met simultaneously', () => {
    const state: ExtractionState = {
      messagesSinceLastExtraction: 15,
      msSinceLastExtraction: 10_000_000,
    }
    expect(shouldExtractContext(state, { messageThreshold: 10, timeThresholdMs: 7_200_000 })).toBe(
      true,
    )
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// extractContext — in-process HTTP mock + real Prisma/SQLite
// ──────────────────────────────────────────────────────────────────────────────

describe('extractContext', () => {
  beforeEach(async () => {
    await prisma.personProfile.deleteMany({ where: { groupId: GROUP } })
    await prisma.groupProfile.deleteMany({ where: { groupId: GROUP } })
  })

  afterEach(async () => {
    server?.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      if (server === undefined) {
        resolve()
        return
      }
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    })
    server = undefined
  })

  afterAll(async () => {
    await prisma.personProfile.deleteMany({ where: { groupId: GROUP } })
    await prisma.groupProfile.deleteMany({ where: { groupId: GROUP } })
    await prisma.$disconnect()
  })

  it('encodes transcript entries in the prompt and stores per-person deltas', async () => {
    let requestBody = ''
    const baseURL = await startMock((request, response) => {
      request.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString()
      })
      request.on('end', () => {
        sendExtraction(response, {
          persons: [
            {
              person_id: 'sam',
              name: 'sam',
              interests: [{ activity: 'climbing', mention_count: 1 }],
              budget_signals: ['tight this month'],
              constraints: ["can't do late nights"],
              availability_mentions: [],
            },
          ],
          group: { shared_interests: [], initiators: [], followers: [], sentiment_notes: [] },
        })
      })
    })

    await extractContext(fixtureTranscript, GROUP, ['sam'], new ClaudeClient({ baseURL }))

    // Transcript text must appear in the serialized prompt — mutation check: removing it breaks this.
    const prompt: string = JSON.parse(requestBody).messages[0].content
    expect(prompt).toContain("I've been curious about that climbing gym near downtown")
    expect(prompt).toContain('sam')

    // Per-person deltas must land in the real DB.
    const profile = await getPersonProfile('sam', GROUP)
    const climbing = profile?.interests.find((i) => i.activity === 'climbing')
    expect(climbing?.mention_count).toBe(1)
    expect(climbing?.confidence).toBeCloseTo(0.3)
    expect(profile?.budget_signals).toContain('tight this month')
    expect(profile?.constraints).toContain("can't do late nights")
  })

  it('one mention × 2 calls yields lower confidence than mention_count=3 in one call', async () => {
    // mutation check: exercises the full pipeline from callStructured through profile-repo's
    // computeConfidence (0.3 * mention_count, capped at 0.9) — flipping the assertion direction
    // or removing the accumulation in mergeInterests would turn this red.
    let callCount = 0
    const baseURL = await startMock((request, response) => {
      callCount++
      const n = callCount
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        if (n <= 2) {
          // Calls 1 and 2: person-a mentions climbing once each time
          sendExtraction(response, {
            persons: [
              {
                person_id: 'extract-person-a',
                name: 'PersonA',
                interests: [{ activity: 'climbing', mention_count: 1 }],
                budget_signals: [],
                constraints: [],
                availability_mentions: [],
              },
            ],
            group: { shared_interests: [], initiators: [], followers: [], sentiment_notes: [] },
          })
        } else {
          // Call 3: person-b mentions climbing three times in a single batch
          sendExtraction(response, {
            persons: [
              {
                person_id: 'extract-person-b',
                name: 'PersonB',
                interests: [{ activity: 'climbing', mention_count: 3 }],
                budget_signals: [],
                constraints: [],
                availability_mentions: [],
              },
            ],
            group: { shared_interests: [], initiators: [], followers: [], sentiment_notes: [] },
          })
        }
      })
    })

    const client = new ClaudeClient({ baseURL })

    // Two separate extractions for person-a, each delivering one mention
    await extractContext(fixtureTranscript, GROUP, ['extract-person-a'], client)
    await extractContext(fixtureTranscript, GROUP, ['extract-person-a'], client)
    // One extraction for person-b delivering three mentions at once
    await extractContext(fixtureTranscript, GROUP, ['extract-person-b'], client)

    const profileA = await getPersonProfile('extract-person-a', GROUP)
    const profileB = await getPersonProfile('extract-person-b', GROUP)

    const climbingA = profileA?.interests.find((i) => i.activity === 'climbing')
    const climbingB = profileB?.interests.find((i) => i.activity === 'climbing')

    // person-a: 1 + 1 = 2 accumulated mentions → confidence = 0.3 × 2 = 0.6
    expect(climbingA?.mention_count).toBe(2)
    expect(climbingA?.confidence).toBeCloseTo(0.6)

    // person-b: 3 mentions in a single call → confidence = 0.3 × 3 = 0.9
    expect(climbingB?.mention_count).toBe(3)
    expect(climbingB?.confidence).toBeCloseTo(0.9)

    // Core mutation check: three mentions must produce strictly higher confidence than two.
    // toBeCloseTo assertions above guarantee both are defined; ?? 0 satisfies no-non-null-assertion.
    expect(climbingB?.confidence ?? 0).toBeGreaterThan(climbingA?.confidence ?? 0)
  })

  it('group-level deltas land in GroupProfile initiators and shared_interests', async () => {
    const baseURL = await startMock((request, response) => {
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        sendExtraction(response, {
          persons: [],
          group: {
            shared_interests: ['climbing', 'bowling'],
            initiators: ['sam'],
            followers: ['jess'],
            sentiment_notes: ['last time at the lake was great'],
          },
        })
      })
    })

    await extractContext(fixtureTranscript, GROUP, ['sam', 'jess'], new ClaudeClient({ baseURL }))

    const group = await getGroupProfile(GROUP)
    expect(group?.shared_interests).toContain('climbing')
    expect(group?.shared_interests).toContain('bowling')
    expect(group?.initiators).toContain('sam')
    expect(group?.followers).toContain('jess')
    expect(group?.sentiment_notes).toContain('last time at the lake was great')
  })

  it('propagates a schema-invalid extraction response as StructuredOutputError, storing nothing', async () => {
    const baseURL = await startMock((request, response) => {
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: REASONING_MODEL,
            content: [
              {
                type: 'tool_use',
                id: 'toolu_test',
                name: 'submit_structured_output',
                input: {
                  persons: [
                    {
                      person_id: 'sam',
                      name: 'sam',
                      // Invalid: mention_count must be a positive int, not a string.
                      interests: [{ activity: 'climbing', mention_count: 'three' }],
                      budget_signals: [],
                      constraints: [],
                      availability_mentions: [],
                    },
                  ],
                  group: {
                    shared_interests: [],
                    initiators: [],
                    followers: [],
                    sentiment_notes: [],
                  },
                },
              },
            ],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        )
      })
    })

    await expect(
      extractContext(fixtureTranscript, GROUP, ['sam'], new ClaudeClient({ baseURL })),
    ).rejects.toMatchObject({
      name: 'StructuredOutputError',
    } satisfies Partial<StructuredOutputError>)

    expect(await getPersonProfile('sam', GROUP)).toBeNull()
  })
})

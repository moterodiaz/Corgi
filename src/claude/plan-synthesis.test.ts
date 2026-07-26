import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../store/client.js'
import { createPlanVersion, getAllPlanVersions, getLatestPlanVersion } from '../store/plan-repo.js'
import { ClaudeClient } from './client.js'
import { StructuredOutputError } from './structured-call.js'
import { REASONING_MODEL } from './models.js'
import { synthesizePlan, type SynthesisContent, type SynthesisInput } from './plan-synthesis.js'
import type { GroupProfile, PersonProfile } from '../types/profile.js'
import type { Plan } from '../types/plan.js'

// Isolated group ID — does not collide with other test files.
const GROUP = 'test-group-synthesis'

const baseGroup: GroupProfile = {
  group_id: GROUP,
  shared_interests: ['climbing'],
  initiators: ['alice'],
  followers: ['bob'],
  sentiment_notes: ['last time at the rock gym was great'],
  updated_at: Date.now(),
}

const basePerson: PersonProfile = {
  person_id: 'alice',
  group_id: GROUP,
  name: 'Alice',
  interests: [{ activity: 'climbing', recency: Date.now(), confidence: 0.9, mention_count: 3 }],
  budget_signals: ['can splurge'],
  constraints: [],
  availability_mentions: ['free weekends'],
  updated_at: Date.now(),
}

const validOutput: SynthesisContent = {
  activity: 'climbing',
  venue: { name: 'The Bouldering Project', source_tool: 'stub', ref_id: 'stub-001' },
  datetime: '2026-08-15T18:00:00-07:00',
  cost_tier: 'mid',
  attendees: { alice: 'pending' },
  rationale: 'Alice loves climbing and the rock gym was great last time.',
  message:
    'Hey! Alice loves climbing and the rock gym was great last time — want to hit The Bouldering Project on Aug 15 at 6pm?',
}

type MockHandler = (request: IncomingMessage, response: ServerResponse) => void

// Module-level so afterEach inside the describe can always reach it.
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

function sendSynthesis(response: ServerResponse, output: SynthesisContent): void {
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

describe('synthesizePlan', () => {
  beforeEach(async () => {
    await prisma.planObject.deleteMany({ where: { groupId: GROUP } })
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
    await prisma.planObject.deleteMany({ where: { groupId: GROUP } })
    await prisma.$disconnect()
  })

  it('first-ever synthesis produces version 1, status proposed, persisted in DB, message references rationale', async () => {
    const baseURL = await startMock((request, response) => {
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        sendSynthesis(response, validOutput)
      })
    })

    const input: SynthesisInput = {
      groupProfile: baseGroup,
      personProfiles: [basePerson],
      currentPlan: null,
      groupId: GROUP,
      client: new ClaudeClient({ baseURL }),
    }

    const { plan, message } = await synthesizePlan(input)

    expect(plan.version).toBe(1)
    expect(plan.status).toBe('proposed')
    expect(plan.rationale).toBe(validOutput.rationale)

    // message must voice the rationale — mock message explicitly contains rationale text.
    expect(message).toContain('Alice loves climbing')

    // plan must be persisted in the real DB.
    const stored = await getLatestPlanVersion(GROUP, plan.plan_id)
    expect(stored).not.toBeNull()
    expect(stored?.version).toBe(1)
    expect(stored?.status).toBe('proposed')
  })

  it('revision increments version to 2, keeps same plan_id, and both versions remain in DB', async () => {
    const planId = randomUUID()

    // Seed v1 directly without calling Claude.
    const v1: Plan = {
      plan_id: planId,
      version: 1,
      status: 'proposed',
      activity: 'climbing',
      venue: { name: 'Old Gym', source_tool: 'stub', ref_id: 'stub-000' },
      datetime: '2026-08-01T17:00:00-07:00',
      cost_tier: 'low',
      attendees: { alice: 'pending' },
      rationale: 'Original plan rationale.',
    }
    await createPlanVersion(GROUP, v1)

    const baseURL = await startMock((request, response) => {
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        sendSynthesis(response, validOutput)
      })
    })

    const input: SynthesisInput = {
      groupProfile: baseGroup,
      personProfiles: [basePerson],
      currentPlan: v1,
      groupId: GROUP,
      client: new ClaudeClient({ baseURL }),
    }

    const { plan: v2 } = await synthesizePlan(input)

    expect(v2.plan_id).toBe(planId)
    expect(v2.version).toBe(2)
    expect(v2.status).toBe('proposed')

    // Both versions must still exist, and v1's content must be byte-for-byte unmutated —
    // not just present. A mutate-then-reinsert bug would pass a length/version-only check.
    const allVersions = await getAllPlanVersions(GROUP, planId)
    expect(allVersions).toHaveLength(2)
    expect(allVersions[0]).toEqual(v1)
    expect(allVersions[1]?.version).toBe(2)
  })

  it('propagates a schema-invalid synthesis response as StructuredOutputError, storing nothing', async () => {
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
                  ...validOutput,
                  // Invalid: datetime must be ISO 8601 with timezone offset.
                  datetime: 'not-a-date',
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

    const input: SynthesisInput = {
      groupProfile: baseGroup,
      personProfiles: [basePerson],
      currentPlan: null,
      groupId: GROUP,
      client: new ClaudeClient({ baseURL }),
    }

    await expect(synthesizePlan(input)).rejects.toMatchObject({
      name: 'StructuredOutputError',
    } satisfies Partial<StructuredOutputError>)

    // Nothing should have been written to the DB.
    const rows = await prisma.planObject.findMany({ where: { groupId: GROUP } })
    expect(rows).toHaveLength(0)
  })
})

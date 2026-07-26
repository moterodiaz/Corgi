import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { prisma } from '../store/client.js'
import { ClaudeClient } from '../claude/client.js'
import { HangoutOrchestrator, type HangoutOrchestratorOutbound } from './hangout-orchestrator.js'
import { type TransportInboundMessage } from '../transport/TransportPort.js'

// Isolated group ID — does not collide with other test files.
const GROUP = `test-group-orchestrator-${randomUUID()}`

type MockHandler = (request: IncomingMessage, response: ServerResponse) => void

// Module-level so afterEach can always reach it.
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

function sendToolUse(response: ServerResponse, model: string, input: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model,
      content: [
        {
          type: 'tool_use',
          id: 'toolu_test',
          name: 'submit_structured_output',
          input,
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  )
}

// Records every sent message in-memory instead of going through a real transport —
// matches the LoggingTransport pattern used in scripts/demo-rehearsal.ts.
class RecordingTransport implements HangoutOrchestratorOutbound {
  readonly sent: Array<{ groupId: string; text: string }> = []

  async sendMessage(input: { groupId: string; text: string }): Promise<unknown> {
    this.sent.push(input)
    return {
      messageId: `test-${String(this.sent.length)}`,
      groupId: input.groupId,
      text: input.text,
      sentAt: new Date(),
    }
  }
}

function inbound(senderId: string, text: string): TransportInboundMessage {
  return {
    messageId: randomUUID(),
    groupId: GROUP,
    senderId,
    text,
    receivedAt: new Date(),
  }
}

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

  await prisma.planObject.deleteMany({ where: { groupId: GROUP } })
  await prisma.personProfile.deleteMany({ where: { groupId: GROUP } })
  await prisma.groupProfile.deleteMany({ where: { groupId: GROUP } })
  await prisma.transcriptBuffer.deleteMany({ where: { groupId: GROUP } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('HangoutOrchestrator', () => {
  it('a message with explicit planning language results in exactly one plan-proposal message being sent', async () => {
    // No active plan exists yet, so processMessage's path is:
    // classifyPlanFeedback skipped (no active plan) -> maybeExtractContext
    // (skipped, threshold not met for a single message) -> classifySpeakNow
    // (call 1, "propose") -> synthesizePlan (call 2) -> transport.sendMessage.
    let callCount = 0
    const baseURL = await startMock((request, response) => {
      callCount += 1
      const n = callCount
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        if (n === 1) {
          sendToolUse(response, 'claude-haiku-4-5-20251001', {
            decision: 'propose',
            reason: 'explicit planning language detected',
          })
        } else {
          sendToolUse(response, 'claude-sonnet-5', {
            activity: 'climbing',
            venue: { name: 'The Bouldering Project', source_tool: 'stub', ref_id: 'stub-001' },
            datetime: '2026-08-15T18:00:00-07:00',
            cost_tier: 'mid',
            attendees: { a: 'pending' },
            rationale: 'Everyone loves climbing.',
            message: 'Hey! Want to hit the climbing gym this weekend?',
          })
        }
      })
    })

    const transport = new RecordingTransport()
    const orchestrator = new HangoutOrchestrator({
      transport,
      claudeClient: new ClaudeClient({ baseURL }),
    })

    await orchestrator.handleMessage(inbound('a', 'we should really hang out this weekend'))

    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.text).toBe('Hey! Want to hit the climbing gym this weekend?')
  })
})

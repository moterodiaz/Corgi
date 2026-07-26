import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeClient } from './client.js'
import { CLASSIFIER_MODEL } from './models.js'
import { classifyPlanFeedback, type PlanFeedback } from './plan-feedback.js'
import type { Plan } from '../types/plan.js'

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

function sendFeedback(response: ServerResponse, output: PlanFeedback): void {
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
          input: output,
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  )
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
})

const plan: Plan = {
  plan_id: randomUUID(),
  version: 1,
  status: 'proposed',
  activity: 'climbing',
  venue: { name: 'The Bouldering Project', source_tool: 'stub', ref_id: 'stub-001' },
  datetime: '2026-08-15T18:00:00-07:00',
  cost_tier: 'mid',
  attendees: { alice: 'pending' },
  rationale: 'Alice loves climbing.',
}

describe('classifyPlanFeedback', () => {
  it('parses an accept-sentiment response on the active plan', async () => {
    const baseURL = await startMock((request, response) => {
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        sendFeedback(response, { is_feedback_on_plan: true, sentiment: 'accept' })
      })
    })

    const result = await classifyPlanFeedback({
      plan,
      message: 'yeah sounds great, count me in',
      senderId: 'alice',
      client: new ClaudeClient({ baseURL }),
    })

    expect(result.is_feedback_on_plan).toBe(true)
    expect(result.sentiment).toBe('accept')
  })
})

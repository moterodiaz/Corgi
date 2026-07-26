import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ClaudeCallError, ClaudeClient } from './client.js'
import { REASONING_MODEL } from './models.js'
import { callStructured, StructuredOutputError } from './structured-call.js'

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

function sendToolResponse(response: ServerResponse, input: unknown): void {
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
          input,
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  )
}

const ResponseSchema = z.object({ activity: z.string(), groupSize: z.number().int().positive() })

describe('callStructured', () => {
  it('uses forced tool output and returns the Zod-typed response', async () => {
    let requestBody = ''
    const baseURL = await startAnthropicMock((request, response) => {
      request.on('data', (chunk: Buffer) => {
        requestBody += chunk.toString()
      })
      request.on('end', () => sendToolResponse(response, { activity: 'bowling', groupSize: 4 }))
    })

    const result = await callStructured({
      schema: ResponseSchema,
      messages: [{ role: 'user', content: 'Plan a hangout.' }],
      model: REASONING_MODEL,
      client: new ClaudeClient({ baseURL }),
    })

    expect(result).toEqual({ activity: 'bowling', groupSize: 4 })
    expect(JSON.parse(requestBody)).toMatchObject({
      model: REASONING_MODEL,
      tool_choice: { type: 'tool', name: 'submit_structured_output' },
      tools: [
        expect.objectContaining({ input_schema: { type: 'object', additionalProperties: true } }),
      ],
    })
  })

  it('surfaces a timeout as a typed ClaudeCallError', async () => {
    const baseURL = await startAnthropicMock((_request, response) => {
      setTimeout(() => sendToolResponse(response, { activity: 'bowling', groupSize: 4 }), 100)
    })
    const client = new ClaudeClient({ baseURL, timeoutMs: 10 })

    await expect(
      client.createMessage({
        model: REASONING_MODEL,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Plan a hangout.' }],
      }),
    ).rejects.toMatchObject({
      name: 'ClaudeCallError',
      code: 'timeout',
    } satisfies Partial<ClaudeCallError>)
  })

  it('rejects schema-violating tool JSON after Zod re-validation', async () => {
    const baseURL = await startAnthropicMock((_request, response) => {
      sendToolResponse(response, { activity: 'bowling', groupSize: 'four' })
    })

    await expect(
      callStructured({
        schema: ResponseSchema,
        messages: [{ role: 'user', content: 'Plan a hangout.' }],
        model: REASONING_MODEL,
        client: new ClaudeClient({ baseURL }),
      }),
    ).rejects.toMatchObject({
      name: 'StructuredOutputError',
      code: 'validation_failed',
    } satisfies Partial<StructuredOutputError>)
  })
})

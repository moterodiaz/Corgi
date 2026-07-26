import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeClient } from '../claude/client.js'
import { REASONING_MODEL } from '../claude/models.js'
import { decideNextLine, type NextLineDecision, type PersonaProfile } from './persona-chat.js'
import type { TranscriptEntry } from '../types/transcript.js'

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

function sendDecision(response: ServerResponse, output: NextLineDecision): void {
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

const persona: PersonaProfile = {
  name: 'Riley',
  textingStyleSample: 'lol yeah fr\nwait no way',
  topics: ['wants to plan a hike'],
}

const transcript: TranscriptEntry[] = [
  {
    sender: 'sam',
    text: 'we should hang out this weekend',
    timestamp: '2026-08-01T09:00:00Z',
    groupId: 'demo-persona-group',
  },
]

describe('decideNextLine', () => {
  it('parses a should_speak=true response with text', async () => {
    const baseURL = await startMock((request, response) => {
      request.on('data', () => {
        /* drain */
      })
      request.on('end', () => {
        sendDecision(response, { should_speak: true, text: 'omg yes finally' })
      })
    })

    const result = await decideNextLine({
      persona,
      transcript,
      nextTopicIndex: 0,
      isClosingStretch: false,
      client: new ClaudeClient({ baseURL }),
    })

    expect(result.should_speak).toBe(true)
    expect(result.text).toBe('omg yes finally')
  })
})

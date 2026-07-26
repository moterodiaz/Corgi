import { fileURLToPath } from 'url'
import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import { config } from './config.js'
import { createBlueBubblesClient } from './transport/BlueBubblesClient.js'
import { BlueBubblesInboundAdapter } from './transport/BlueBubblesInboundAdapter.js'
import { BlueBubblesOutboundAdapter } from './transport/BlueBubblesOutboundAdapter.js'
import { HangoutOrchestrator } from './orchestrator/hangout-orchestrator.js'

export async function buildServer() {
  const server = Fastify({
    logger: {
      level: 'info',
      redact: [
        'ANTHROPIC_API_KEY',
        'MERGE_API_KEY',
        'BLUEBUBBLES_SERVER_PASSWORD',
        'config.ANTHROPIC_API_KEY',
        'config.MERGE_API_KEY',
        'config.BLUEBUBBLES_SERVER_PASSWORD',
      ],
    },
  }).withTypeProvider<ZodTypeProvider>()

  server.setValidatorCompiler(validatorCompiler)
  server.setSerializerCompiler(serializerCompiler)

  server.get(
    '/health',
    {
      schema: {
        response: {
          200: z.object({ status: z.literal('ok') }),
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  )

  return server
}

// Wires the real bot: BlueBubbles transport <-> HangoutOrchestrator. Kept
// separate from buildServer() so importing this module for the /health
// route's tests never opens a live BlueBubbles connection.
export function startHangoutBot(): BlueBubblesInboundAdapter {
  const client = createBlueBubblesClient({
    server_url: config.BLUEBUBBLES_SERVER_URL,
    password: config.BLUEBUBBLES_SERVER_PASSWORD,
  })
  const outbound = new BlueBubblesOutboundAdapter({ client })
  const inbound = new BlueBubblesInboundAdapter({
    server_url: config.BLUEBUBBLES_SERVER_URL,
    password: config.BLUEBUBBLES_SERVER_PASSWORD,
  })
  const orchestrator = new HangoutOrchestrator({ transport: outbound })

  inbound.onMessage((message) => orchestrator.handleMessage(message))
  inbound.onCardInteraction((interaction) => orchestrator.handleCardInteraction(interaction))
  inbound.connect()

  return inbound
}

// Entry-point guard: only listen when run directly, not when imported for tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await buildServer()
  await server.listen({ port: 3000, host: '0.0.0.0' })
  server.log.info({ port: 3000 }, 'Corgi server started')
  startHangoutBot()
  server.log.info({ url: config.BLUEBUBBLES_SERVER_URL }, 'Hangout bot connected to BlueBubbles')
}

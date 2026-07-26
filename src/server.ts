import { fileURLToPath } from 'url'
import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import { config } from './config.js'

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

// Entry-point guard: only listen when run directly, not when imported for tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await buildServer()
  await server.listen({ port: 3000, host: '0.0.0.0' })
  server.log.info({ port: 3000 }, 'Corgi server started')
  // Suppress unused-import lint error — config is imported for side-effect validation
  void config
}

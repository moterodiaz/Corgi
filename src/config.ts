import 'dotenv/config'
import { z } from 'zod'

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  MERGE_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  // BlueBubbles Server (self-hosted, local) replaces the paid Photon/Spectrum
  // transport on this branch — see src/transport/BlueBubbles*.ts.
  BLUEBUBBLES_SERVER_URL: z.string().min(1).url(),
  BLUEBUBBLES_SERVER_PASSWORD: z.string().min(1),
})

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration — check .env.example for required vars:\n${JSON.stringify(parsed.error.format(), null, 2)}`,
  )
}

// Single export; no other file reads process.env directly.
export const config = parsed.data

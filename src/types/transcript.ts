import { z } from 'zod'

export const TranscriptEntrySchema = z.object({
  sender: z.string(),
  text: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  groupId: z.string(),
})

export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>

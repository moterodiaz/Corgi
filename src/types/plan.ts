import { z } from 'zod'

export const VenueSchema = z.object({
  name: z.string(),
  source_tool: z.string(),
  ref_id: z.string(),
})

// Matches design-doc.md §8 exactly.
export const PlanSchema = z.object({
  plan_id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['proposed', 'revising', 'confirmed', 'abandoned']),
  activity: z.string(),
  venue: VenueSchema,
  datetime: z.string().datetime({ offset: true }),
  cost_tier: z.string(),
  attendees: z.record(z.string(), z.enum(['yes', 'no', 'pending'])),
  rationale: z.string(),
})

export type Plan = z.infer<typeof PlanSchema>
export type Venue = z.infer<typeof VenueSchema>

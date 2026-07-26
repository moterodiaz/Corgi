import { z } from 'zod'

// Per design-doc.md §6: a single mention is weaker signal than three.
// mention_count drives confidence recalculation in the profile-repo upsert logic.
const ActivityMentionSchema = z.object({
  activity: z.string(),
  recency: z.number().int().nonnegative(), // Unix ms of last mention
  confidence: z.number().min(0).max(1),
  mention_count: z.number().int().positive(),
})

export const PersonProfileSchema = z.object({
  person_id: z.string(),
  group_id: z.string(),
  name: z.string(),
  interests: z.array(ActivityMentionSchema),
  budget_signals: z.array(z.string()),
  constraints: z.array(z.string()),
  availability_mentions: z.array(z.string()),
  updated_at: z.number().int().nonnegative(), // Unix ms
})

export const GroupProfileSchema = z.object({
  group_id: z.string(),
  shared_interests: z.array(z.string()),
  initiators: z.array(z.string()), // person_ids who tend to start planning
  followers: z.array(z.string()), // person_ids who tend to go along
  sentiment_notes: z.array(z.string()),
  updated_at: z.number().int().nonnegative(), // Unix ms
})

export type PersonProfile = z.infer<typeof PersonProfileSchema>
export type GroupProfile = z.infer<typeof GroupProfileSchema>
export type ActivityMention = z.infer<typeof ActivityMentionSchema>

import { z } from 'zod'
import { upsertGroupProfile, upsertPersonProfile } from '../store/profile-repo.js'
import { type TranscriptEntry } from '../types/transcript.js'
import { type ClaudeClient } from './client.js'
import { REASONING_MODEL } from './models.js'
import { callStructured } from './structured-call.js'

// Default thresholds per design-doc §6: "every N messages or every few hours".
// 10 messages is the smallest batch worth sending to a reasoning model;
// 2 h covers "every few hours of activity" at the low end.
const DEFAULT_MESSAGE_THRESHOLD = 10
const DEFAULT_TIME_THRESHOLD_MS = 2 * 60 * 60 * 1_000 // 2 hours in ms

export interface ExtractionState {
  messagesSinceLastExtraction: number
  msSinceLastExtraction: number
}

export interface ExtractionConfig {
  messageThreshold?: number
  timeThresholdMs?: number
}

/** Returns true if either the message-count or elapsed-time threshold has been reached. */
export function shouldExtractContext(
  state: ExtractionState,
  config: ExtractionConfig = {},
): boolean {
  const msgThreshold = config.messageThreshold ?? DEFAULT_MESSAGE_THRESHOLD
  const timeThreshold = config.timeThresholdMs ?? DEFAULT_TIME_THRESHOLD_MS
  return (
    state.messagesSinceLastExtraction >= msgThreshold ||
    state.msSinceLastExtraction >= timeThreshold
  )
}

// Claude returns mention_count per activity; confidence is recomputed by profile-repo's
// mergeInterests so this layer never needs to touch the confidence formula itself.
const PersonInterestDeltaSchema = z.object({
  activity: z.string(),
  mention_count: z.number().int().positive(),
})

const PersonDeltaSchema = z.object({
  person_id: z.string(),
  name: z.string(),
  interests: z.array(PersonInterestDeltaSchema),
  budget_signals: z.array(z.string()),
  constraints: z.array(z.string()),
  availability_mentions: z.array(z.string()),
})

const GroupDeltaSchema = z.object({
  shared_interests: z.array(z.string()),
  initiators: z.array(z.string()),
  followers: z.array(z.string()),
  sentiment_notes: z.array(z.string()),
})

export const ExtractionOutputSchema = z.object({
  persons: z.array(PersonDeltaSchema),
  group: GroupDeltaSchema,
})

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>

function buildExtractionPrompt(entries: TranscriptEntry[], knownPersonIds: string[]): string {
  const lines = entries.map((e) => `[${e.sender}] ${e.timestamp}: ${e.text}`).join('\n')

  return `You are a context-extraction module for a group hangout-planning agent.

Extract structured profile deltas from the following group chat transcript.
Known participant IDs: ${knownPersonIds.join(', ')}.

<transcript>
${lines}
</transcript>

For each participant who appears in the transcript, extract:
- interests: activities or hobbies mentioned, with mention_count reflecting how many times in THIS batch
- budget_signals: statements about financial constraints (e.g. "broke this month", "can splurge")
- constraints: dietary restrictions, mobility limits, hard limits (e.g. "can't do late nights")
- availability_mentions: when they said they are free or busy (fallback when no calendar is connected)

For the group as a whole, extract:
- shared_interests: activities multiple people expressed interest in
- initiators: person_ids of people who tend to propose or push for plans in this excerpt
- followers: person_ids of people who tend to go along with others' suggestions
- sentiment_notes: references to past hangouts (e.g. "that was so fun", "never doing that venue again")

Return only what is evidenced by the transcript. Include all keys but use empty arrays when nothing was found.
All mention_count values must be positive integers.`
}

/**
 * Calls Claude (REASONING_MODEL) to extract per-person and group-level context deltas from a
 * transcript batch, then persists them via upsertPersonProfile / upsertGroupProfile.
 * Confidence math is owned entirely by profile-repo — this layer only supplies mention_count.
 */
export async function extractContext(
  entries: TranscriptEntry[],
  groupId: string,
  knownPersonIds: string[],
  client?: ClaudeClient,
): Promise<void> {
  const now = Date.now()

  const output = await callStructured({
    schema: ExtractionOutputSchema,
    messages: [
      {
        role: 'user',
        content: buildExtractionPrompt(entries, knownPersonIds),
      },
    ],
    model: REASONING_MODEL,
    maxTokens: 2_048,
    client,
  })

  // Sequential, not Promise.all: upsertPersonProfile does an unlocked read-then-write, so
  // concurrent calls for the same person_id (e.g. Claude emitting two deltas for one person
  // in a batch) would race and silently drop one delta's updates.
  for (const delta of output.persons) {
    await upsertPersonProfile(delta.person_id, groupId, delta.name, {
      interests: delta.interests.map((i) => ({
        activity: i.activity,
        recency: now,
        // ponytail: placeholder; profile-repo.mergeInterests overwrites this with computeConfidence(mention_count)
        confidence: 0.3,
        mention_count: i.mention_count,
      })),
      budget_signals: delta.budget_signals,
      constraints: delta.constraints,
      availability_mentions: delta.availability_mentions,
    })
  }

  await upsertGroupProfile(groupId, output.group)
}

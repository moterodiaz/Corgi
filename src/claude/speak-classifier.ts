import { z } from 'zod'
import { type PersonProfile } from '../types/profile.js'
import { type TranscriptEntry } from '../types/transcript.js'
import { type ClaudeClient } from './client.js'
import { CLASSIFIER_MODEL } from './models.js'
import { callStructured } from './structured-call.js'

export const SpeakDecisionSchema = z.object({
  decision: z.enum(['silent', 'clarifying', 'propose']),
  // Short auditable reason — model fills this in, kept ≤200 chars to stay cheap.
  reason: z.string().max(200),
})

export type SpeakDecision = z.infer<typeof SpeakDecisionSchema>

export interface ClassifySpeakNowInput {
  entries: TranscriptEntry[]
  profiles: PersonProfile[]
  /** Total number of members in the group, for coverage ratio. */
  groupSize: number
  /** Caller-supplied elapsed time so tests are deterministic and the function stays pure. */
  minutesSinceLastMessage: number
  client?: ClaudeClient
}

function buildPrompt(
  entries: TranscriptEntry[],
  profiledCount: number,
  groupSize: number,
  minutesSinceLastMessage: number,
): string {
  const lines = entries.map((e) => `[${e.sender}]: ${e.text}`).join('\n')

  return `You are a social-awareness module for a group hangout-planning agent.

Recent messages:
<transcript>
${lines}
</transcript>

Profile coverage: ${profiledCount} of ${groupSize} group members have usable preference data.
Time since last message: ${minutesSinceLastMessage} minutes.

Decide whether the agent should speak now. Return one of:
- "silent": stay quiet
- "clarifying": ask a gentle clarifying question
- "propose": suggest a specific hangout plan

Signals that push toward "propose":
- Explicit planning language ("we should hang out," "what should we do this weekend")
- Enough profile confidence across enough group members
- A lull after planning-adjacent talk (conversation trailed off without landing on something)

Signals that push toward "silent":
- Pure reminiscing or joking with no forward-looking intent
- A very recent unresolved disagreement — do not interrupt an argument with a suggestion
- Insufficient profile coverage — too few group members have said anything usable

Default bias: wait longer than feels necessary. An agent that proposes too early reads as eager and annoying; one that waits for a clear opening reads as attentive. When signals are ambiguous, return "silent".`
}

export async function classifySpeakNow({
  entries,
  profiles,
  groupSize,
  minutesSinceLastMessage,
  client,
}: ClassifySpeakNowInput): Promise<SpeakDecision> {
  const profiledCount = profiles.filter((p) => p.interests.length > 0).length

  return callStructured({
    schema: SpeakDecisionSchema,
    messages: [
      {
        role: 'user',
        content: buildPrompt(entries, profiledCount, groupSize, minutesSinceLastMessage),
      },
    ],
    model: CLASSIFIER_MODEL,
    maxTokens: 256,
    client,
  })
}

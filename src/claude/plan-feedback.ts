import { z } from 'zod'
import { type Plan } from '../types/plan.js'
import { type ClaudeClient } from './client.js'
import { CLASSIFIER_MODEL } from './models.js'
import { callStructured } from './structured-call.js'

// Minimal stand-in for design-doc.md §9's full Feedback/Diff layer (P3-5):
// classifies whether a new message is feedback on the currently active plan
// at all, and if so, whether it's an acceptance or a rejection. It does not
// attempt the fielded diff (hard_constraint/preference_nudge/full_reject)
// P3-5 describes — synthesizePlan's `feedback` free-text input (see
// plan-synthesis.ts) folds the reason back into a full revision pass
// instead, which is a real, scoped simplification for this demo, not a
// stub: every branch of this classifier's output is acted on.
export const PlanFeedbackSchema = z.object({
  is_feedback_on_plan: z.boolean(),
  sentiment: z.enum(['accept', 'reject', 'neutral']),
  // Populated when sentiment is 'reject' — the concrete reason to fold into
  // the next synthesis pass (e.g. "too expensive", "Sam can't do Saturday").
  reason: z.string().max(300).optional(),
})

export type PlanFeedback = z.infer<typeof PlanFeedbackSchema>

export interface ClassifyPlanFeedbackInput {
  plan: Plan
  message: string
  senderId: string
  client?: ClaudeClient
}

function buildPrompt(input: ClassifyPlanFeedbackInput): string {
  const { plan, message, senderId } = input

  return `You are reading one new message in a group chat that has an active hangout plan proposal.

<current_plan>
Activity: ${plan.activity}
Venue: ${plan.venue.name}
Datetime: ${plan.datetime}
Cost tier: ${plan.cost_tier}
Status: ${plan.status}
</current_plan>

New message from ${senderId}: "${message}"

Decide:
- is_feedback_on_plan: true only if this message is actually reacting to the
  plan above (accepting it, rejecting/pushing back on it, or requesting a
  change to it) — false for unrelated chatter, even if it's planning-adjacent.
- sentiment: "accept" if they're on board with the plan as-is, "reject" if
  they're pushing back or asking for something different, "neutral" if
  is_feedback_on_plan is false, or the message is ambiguous/non-committal.
- reason: when sentiment is "reject", the concrete, specific reason
  (e.g. "too expensive", "can't make that time") — short, in their words.
  Omit for "accept"/"neutral".

Default to is_feedback_on_plan: false and sentiment: "neutral" when genuinely ambiguous — do not invent feedback that isn't there.`
}

export async function classifyPlanFeedback(
  input: ClassifyPlanFeedbackInput,
): Promise<PlanFeedback> {
  return callStructured({
    schema: PlanFeedbackSchema,
    messages: [{ role: 'user', content: buildPrompt(input) }],
    model: CLASSIFIER_MODEL,
    maxTokens: 256,
    client: input.client,
  })
}

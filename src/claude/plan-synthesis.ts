import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createPlanVersion } from '../store/plan-repo.js'
import { type GroupProfile, type PersonProfile } from '../types/profile.js'
import { type Plan, VenueSchema } from '../types/plan.js'
import { type ClaudeClient } from './client.js'
import { REASONING_MODEL } from './models.js'
import { callStructured } from './structured-call.js'

export interface VenueCandidate {
  name: string
  source_tool: string
  ref_id: string
}

// ponytail: stub until P4-2/P4-3 Merge tools replace this with real retrieval.
// Kept larger than 3 entries so a demo with a couple of rejection rounds
// (§11) doesn't run out of genuinely different options to offer next.
export async function retrieveCandidates(_activity: string): Promise<VenueCandidate[]> {
  return [
    { name: 'The Bouldering Project', source_tool: 'stub', ref_id: 'stub-001' },
    { name: 'Topgolf', source_tool: 'stub', ref_id: 'stub-002' },
    { name: 'City Escape Rooms', source_tool: 'stub', ref_id: 'stub-003' },
    { name: 'Pinstripes Bowling & Bocce', source_tool: 'stub', ref_id: 'stub-004' },
    { name: 'Museum of Ice Cream', source_tool: 'stub', ref_id: 'stub-005' },
    { name: 'Local trailhead + picnic', source_tool: 'stub', ref_id: 'stub-006' },
    { name: 'Board game cafe', source_tool: 'stub', ref_id: 'stub-007' },
    { name: 'Karaoke lounge', source_tool: 'stub', ref_id: 'stub-008' },
  ]
}

const SynthesisContentSchema = z.object({
  activity: z.string(),
  venue: VenueSchema,
  datetime: z.string().datetime({ offset: true }),
  cost_tier: z.string(),
  attendees: z.record(z.string(), z.enum(['yes', 'no', 'pending'])),
  rationale: z.string(),
  message: z.string(),
})

export type SynthesisContent = z.infer<typeof SynthesisContentSchema>

export interface SynthesisInput {
  groupProfile: GroupProfile
  personProfiles: PersonProfile[]
  currentPlan: Plan | null
  groupId: string
  client?: ClaudeClient
  // Concrete rejection reason from plan-feedback.ts's classifyPlanFeedback,
  // when this call is revising in response to pushback rather than a fresh
  // proposal. Folded into the revision prompt so "too expensive" actually
  // changes the outcome, not just the version number.
  feedback?: string
  // ref_ids of venues already rejected earlier in this plan's revision
  // history — excluded from candidates so a revision can't re-suggest the
  // exact place that was just turned down.
  excludeVenueRefIds?: string[]
}

function buildSynthesisPrompt(input: SynthesisInput, candidates: VenueCandidate[]): string {
  const { groupProfile, personProfiles, currentPlan, feedback } = input

  const profileLines = personProfiles
    .map(
      (p) =>
        `${p.name} (${p.person_id}): interests=[${p.interests.map((i) => i.activity).join(', ')}], budget=[${p.budget_signals.join('; ')}], constraints=[${p.constraints.join('; ')}], availability=[${p.availability_mentions.join('; ')}]`,
    )
    .join('\n')

  const candidateLines = candidates
    .map((c) => `- ${c.name} (tool=${c.source_tool}, ref=${c.ref_id})`)
    .join('\n')

  const feedbackLine =
    feedback !== undefined
      ? `\n\nThe group's specific feedback on the previous version: "${feedback}" — the new pick must genuinely address this, not just change cosmetically.`
      : ''

  const revisionBlock = currentPlan
    ? `\n<current_plan>
Activity: ${currentPlan.activity}
Venue: ${currentPlan.venue.name}
Datetime: ${currentPlan.datetime}
Rationale: ${currentPlan.rationale}
</current_plan>

You are revising the plan above based on new information or feedback. Improve it.${feedbackLine}`
    : 'This is the first proposal for this group.'

  return `You are planning a hangout for a group of friends. Your job is to suggest something genuinely exciting and specific — not a generic logistics dump, but a warm, thoughtful proposal from a friend who knows what everyone actually likes.

<group_profile>
Shared interests: ${groupProfile.shared_interests.join(', ') || 'none recorded'}
Initiators (tend to propose plans): ${groupProfile.initiators.join(', ') || 'none recorded'}
Followers (tend to go along with others): ${groupProfile.followers.join(', ') || 'none recorded'}
Sentiment notes: ${groupProfile.sentiment_notes.join('; ') || 'none'}
</group_profile>

<person_profiles>
${profileLines || 'No individual profiles yet.'}
</person_profiles>

<venue_candidates>
${candidateLines}
</venue_candidates>
${revisionBlock}

Choose the best activity and venue from the candidates above. Pick a specific datetime in ISO 8601 format with timezone offset. Set all known attendees to "pending". Write a rationale in a warm, specific "thoughtful friend" tone — reference what you know about people's actual interests and past experiences. Write a message that could be sent directly in the group chat to propose this hangout; the message should voice the rationale naturally.

Attendee person_ids to include: ${personProfiles.map((p) => p.person_id).join(', ') || 'none'}`
}

export async function synthesizePlan(
  input: SynthesisInput,
): Promise<{ plan: Plan; message: string }> {
  const { currentPlan, groupId, client, groupProfile, excludeVenueRefIds } = input

  const activityHint = currentPlan?.activity ?? groupProfile.shared_interests[0] ?? 'hangout'
  const allCandidates = await retrieveCandidates(activityHint)
  const excluded = new Set(excludeVenueRefIds ?? [])
  const candidates =
    excluded.size === 0 ? allCandidates : allCandidates.filter((c) => !excluded.has(c.ref_id))

  if (candidates.length === 0) {
    throw new Error('synthesizePlan: no venue candidates remain after excluding rejected venues')
  }

  const output = await callStructured({
    schema: SynthesisContentSchema,
    messages: [
      {
        role: 'user',
        content: buildSynthesisPrompt(input, candidates),
      },
    ],
    model: REASONING_MODEL,
    maxTokens: 1_024,
    client,
  })

  if (!candidates.some((c) => c.ref_id === output.venue.ref_id)) {
    throw new Error(
      `synthesizePlan: model returned venue ref_id "${output.venue.ref_id}" not present in retrieved candidates`,
    )
  }

  const plan: Plan = {
    plan_id: currentPlan !== null ? currentPlan.plan_id : randomUUID(),
    version: currentPlan !== null ? currentPlan.version + 1 : 1,
    status: 'proposed',
    activity: output.activity,
    venue: output.venue,
    datetime: output.datetime,
    cost_tier: output.cost_tier,
    attendees: output.attendees,
    rationale: output.rationale,
  }

  const persisted = await createPlanVersion(groupId, plan)

  return { plan: persisted, message: output.message }
}

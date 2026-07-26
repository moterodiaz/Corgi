// BlueBubbles/plain iMessage has no mini-app-card or markdown rendering —
// this renders the same PlanObject the Spectrum mini-app card would have
// used (design-doc.md §8) as a plain, emoji-formatted text block instead.

export type PlanStatus = 'proposed' | 'revising' | 'confirmed' | 'abandoned'
export type RsvpState = 'yes' | 'no' | 'pending'

export interface PlanObject {
  planId: string
  version: number
  status: PlanStatus
  activity: string
  venue: {
    name: string
    sourceTool: string
    refId: string
  }
  datetime: string
  costTier: 'low' | 'medium' | 'high'
  attendees: Record<string, RsvpState>
  rationale: string
}

const STATUS_LABEL: Readonly<Record<PlanStatus, string>> = {
  proposed: 'Proposed',
  revising: 'Revising',
  confirmed: '✅ Confirmed',
  abandoned: 'Abandoned',
}

const COST_TIER_LABEL: Readonly<Record<PlanObject['costTier'], string>> = {
  low: 'low cost',
  medium: 'medium cost',
  high: 'higher cost',
}

const RSVP_EMOJI: Readonly<Record<RsvpState, string>> = {
  yes: '✅',
  no: '❌',
  pending: '⏳',
}

export function renderPlanMessageText(plan: PlanObject): string {
  const header = plan.version > 1 ? `🔄 Updated plan (v${String(plan.version)})` : '📍 New plan'
  const rsvpLines = Object.entries(plan.attendees)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([attendee, state]) => `${RSVP_EMOJI[state]} ${attendee}`)

  const lines = [
    header,
    '',
    `${titleCase(plan.activity)} at ${plan.venue.name}`,
    formatDateTime(plan.datetime),
    `💰 ${COST_TIER_LABEL[plan.costTier]}`,
    '',
    plan.rationale,
    '',
    STATUS_LABEL[plan.status],
    ...rsvpLines,
  ]

  return lines.join('\n')
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function titleCase(value: string): string {
  if (!value) {
    return value
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}

import { describe, it, expect } from 'vitest'
import { PlanSchema } from './plan.js'

const validPlan = {
  plan_id: '123e4567-e89b-12d3-a456-426614174000',
  version: 1,
  status: 'proposed' as const,
  activity: 'climbing gym session',
  venue: { name: 'Rock Wall Gym', source_tool: 'merge_search_venues', ref_id: 'v-001' },
  datetime: '2026-08-02T14:00:00-07:00',
  cost_tier: 'low',
  attendees: { sam: 'yes', jess: 'pending', alex: 'no' },
  rationale: 'Sam mentioned wanting to try climbing; kept it low-cost for Jess.',
}

describe('PlanSchema', () => {
  it('parses a fully valid plan object', () => {
    const result = PlanSchema.safeParse(validPlan)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plan_id).toBe(validPlan.plan_id)
      expect(result.data.version).toBe(1)
      expect(result.data.attendees['sam']).toBe('yes')
    }
  })

  it('rejects a plan with an invalid status enum value', () => {
    const result = PlanSchema.safeParse({ ...validPlan, status: 'maybe' })
    expect(result.success).toBe(false)
  })

  it('rejects a plan with a non-UUID plan_id', () => {
    const result = PlanSchema.safeParse({ ...validPlan, plan_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects a plan with an invalid attendee RSVP value', () => {
    const result = PlanSchema.safeParse({
      ...validPlan,
      attendees: { sam: 'maybe' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a plan with version 0 (must be positive)', () => {
    const result = PlanSchema.safeParse({ ...validPlan, version: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects a plan missing required fields', () => {
    const result = PlanSchema.safeParse({ ...validPlan, activity: undefined })
    expect(result.success).toBe(false)
  })
})

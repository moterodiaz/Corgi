import { describe, expect, it } from 'vitest'
import type { Plan } from '../types/plan.js'
import { PlanEvents, transition, type PlanEvent } from './plan-state-machine.js'

function makePlan(status: Plan['status']): Plan {
  return {
    plan_id: '123e4567-e89b-12d3-a456-426614174000',
    version: 3,
    status,
    activity: 'climbing gym session',
    venue: { name: 'Rock Wall Gym', source_tool: 'fixture', ref_id: 'v-001' },
    datetime: '2026-08-02T14:00:00-07:00',
    cost_tier: 'low',
    attendees: { sam: 'yes', jess: 'pending' },
    rationale: 'Sam mentioned wanting to try climbing.',
  }
}

describe('plan state machine', () => {
  it.each<[Plan['status'], PlanEvent, Plan['status']]>([
    ['proposed', 'feedback_hard_constraint', 'revising'],
    ['proposed', 'feedback_preference_nudge', 'revising'],
    ['proposed', 'feedback_full_reject', 'revising'],
    ['proposed', 'confirm', 'confirmed'],
    ['proposed', 'abandon', 'abandoned'],
    ['revising', 'synthesis_completed', 'proposed'],
    ['revising', 'abandon', 'abandoned'],
    ['confirmed', 'feedback_hard_constraint', 'revising'],
    ['confirmed', 'feedback_preference_nudge', 'revising'],
    ['confirmed', 'feedback_full_reject', 'revising'],
    ['confirmed', 'abandon', 'abandoned'],
  ])('moves %s with %s to %s', (fromStatus, event, expectedStatus) => {
    const input = makePlan(fromStatus)
    const result = transition(input, event)

    expect(result).not.toHaveProperty('error')
    if ('error' in result) throw new Error('Expected a valid transition')

    expect(result.status).toBe(expectedStatus)
    expect(result.version).toBe(4)
    expect(input.status).toBe(fromStatus)
    expect(input.version).toBe(3)
    expect(result).not.toBe(input)
  })

  it('rejects a confirmed plan returning directly to proposed', () => {
    const result = transition(makePlan('confirmed'), 'synthesis_completed')

    expect(result).toEqual({
      error: {
        code: 'INVALID_PLAN_TRANSITION',
        fromStatus: 'confirmed',
        event: 'synthesis_completed',
      },
    })
  })

  it.each(PlanEvents)('rejects %s from an abandoned plan', (event) => {
    const result = transition(makePlan('abandoned'), event)

    expect(result).toEqual({
      error: {
        code: 'INVALID_PLAN_TRANSITION',
        fromStatus: 'abandoned',
        event,
      },
    })
  })

  it('rejects confirming a revising plan before a new synthesis', () => {
    const result = transition(makePlan('revising'), 'confirm')

    expect(result).toEqual({
      error: {
        code: 'INVALID_PLAN_TRANSITION',
        fromStatus: 'revising',
        event: 'confirm',
      },
    })
  })
})

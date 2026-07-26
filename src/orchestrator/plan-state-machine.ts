import type { Plan } from '../types/plan.js'

type PlanStatus = Plan['status']

export const PlanEvents = [
  'feedback_hard_constraint',
  'feedback_preference_nudge',
  'feedback_full_reject',
  'synthesis_completed',
  'confirm',
  'abandon',
] as const

export type PlanEvent = (typeof PlanEvents)[number]

export const validTransitions: Record<PlanStatus, Partial<Record<PlanEvent, PlanStatus>>> = {
  proposed: {
    feedback_hard_constraint: 'revising',
    feedback_preference_nudge: 'revising',
    feedback_full_reject: 'revising',
    confirm: 'confirmed',
    abandon: 'abandoned',
  },
  revising: {
    synthesis_completed: 'proposed',
    abandon: 'abandoned',
  },
  confirmed: {
    feedback_hard_constraint: 'revising',
    feedback_preference_nudge: 'revising',
    feedback_full_reject: 'revising',
    abandon: 'abandoned',
  },
  abandoned: {},
}

export type InvalidPlanTransition = {
  error: {
    code: 'INVALID_PLAN_TRANSITION'
    fromStatus: PlanStatus
    event: PlanEvent
  }
}

export type TransitionResult = Plan | InvalidPlanTransition

export function transition(plan: Plan, event: PlanEvent): TransitionResult {
  const toStatus = validTransitions[plan.status][event]

  if (toStatus === undefined) {
    return {
      error: {
        code: 'INVALID_PLAN_TRANSITION',
        fromStatus: plan.status,
        event,
      },
    }
  }

  // Repository writes are append-only, so each transition returns the next version.
  return {
    ...plan,
    status: toStatus,
    version: plan.version + 1,
  }
}

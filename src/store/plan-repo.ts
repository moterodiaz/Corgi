import { prisma } from './client.js'
import { PlanSchema, type Plan } from '../types/plan.js'

function rowToPlan(row: {
  planId: string
  version: number
  status: string
  activity: string
  venue: string
  datetime: string
  costTier: string
  attendees: string
  rationale: string
}): Plan {
  return PlanSchema.parse({
    plan_id: row.planId,
    version: row.version,
    status: row.status,
    activity: row.activity,
    venue: JSON.parse(row.venue) as unknown,
    datetime: row.datetime,
    cost_tier: row.costTier,
    attendees: JSON.parse(row.attendees) as unknown,
    rationale: row.rationale,
  })
}

// Always inserts a new row — never mutates a prior version in place.
// The @@unique([planId, version]) constraint in schema.prisma enforces this at DB level.
export async function createPlanVersion(groupId: string, plan: Plan): Promise<Plan> {
  const row = await prisma.planObject.create({
    data: {
      planId: plan.plan_id,
      version: plan.version,
      groupId,
      status: plan.status,
      activity: plan.activity,
      venue: JSON.stringify(plan.venue),
      datetime: plan.datetime,
      costTier: plan.cost_tier,
      attendees: JSON.stringify(plan.attendees),
      rationale: plan.rationale,
    },
  })
  return rowToPlan(row)
}

// Returns the highest version for a given plan within a group, or null if none exists.
export async function getLatestPlanVersion(groupId: string, planId: string): Promise<Plan | null> {
  const row = await prisma.planObject.findFirst({
    where: { groupId, planId },
    orderBy: { version: 'desc' },
  })
  if (!row) return null
  return rowToPlan(row)
}

// Used by tests and auditing; not exposed to the orchestrator.
export async function getAllPlanVersions(groupId: string, planId: string): Promise<Plan[]> {
  const rows = await prisma.planObject.findMany({
    where: { groupId, planId },
    orderBy: { version: 'asc' },
  })
  return rows.map(rowToPlan)
}

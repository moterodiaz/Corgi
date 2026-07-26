import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from './client.js'
import { createPlanVersion, getLatestPlanVersion, getAllPlanVersions } from './plan-repo.js'
import type { Plan } from '../types/plan.js'

const GROUP = 'test-group-plan'

function makePlan({
  plan_id,
  version,
  ...rest
}: Partial<Plan> & { plan_id: string; version: number }): Plan {
  return {
    plan_id,
    version,
    status: 'proposed',
    activity: 'bowling',
    venue: { name: 'Lucky Strike', source_tool: 'fixture', ref_id: 'v001' },
    datetime: '2026-08-01T18:00:00-07:00',
    cost_tier: 'low',
    attendees: { sam: 'yes', jess: 'pending' },
    rationale: 'Sam mentioned bowling',
    ...rest,
  }
}

beforeEach(async () => {
  await prisma.planObject.deleteMany({ where: { groupId: GROUP } })
})

afterAll(async () => {
  await prisma.planObject.deleteMany({ where: { groupId: GROUP } })
  await prisma.$disconnect()
})

describe('createPlanVersion', () => {
  it('persists a plan and returns a Zod-validated Plan', async () => {
    const plan = makePlan({ plan_id: crypto.randomUUID(), version: 1 })
    const saved = await createPlanVersion(GROUP, plan)
    expect(saved.plan_id).toBe(plan.plan_id)
    expect(saved.version).toBe(1)
    expect(saved.activity).toBe('bowling')
    expect(saved.attendees['sam']).toBe('yes')
  })

  // THE critical invariant: version 2 must NOT overwrite version 1's row.
  // This test will fail if createPlanVersion uses upsert instead of insert.
  it('creating v2 leaves v1 row intact with original data', async () => {
    const planId = crypto.randomUUID()
    const v1 = makePlan({ plan_id: planId, version: 1, activity: 'bowling' })
    const v2 = makePlan({ plan_id: planId, version: 2, activity: 'climbing' })

    await createPlanVersion(GROUP, v1)
    await createPlanVersion(GROUP, v2)

    const all = await getAllPlanVersions(GROUP, planId)
    expect(all).toHaveLength(2)

    // v1 must still have its original activity — not mutated by v2 write
    expect(all.find((p) => p.version === 1)?.activity).toBe('bowling')
    expect(all.find((p) => p.version === 2)?.activity).toBe('climbing')
  })

  it('rejects a duplicate (planId, version) pair', async () => {
    const planId = crypto.randomUUID()
    const plan = makePlan({ plan_id: planId, version: 1 })
    await createPlanVersion(GROUP, plan)
    // Second write with same (planId, version) must throw — DB unique constraint
    await expect(createPlanVersion(GROUP, plan)).rejects.toThrow()
  })
})

describe('getLatestPlanVersion', () => {
  it('returns the highest version when multiple exist', async () => {
    const planId = crypto.randomUUID()
    await createPlanVersion(GROUP, makePlan({ plan_id: planId, version: 1, activity: 'v1' }))
    await createPlanVersion(GROUP, makePlan({ plan_id: planId, version: 2, activity: 'v2' }))
    await createPlanVersion(GROUP, makePlan({ plan_id: planId, version: 3, activity: 'v3' }))

    const latest = await getLatestPlanVersion(GROUP, planId)
    expect(latest?.version).toBe(3)
    expect(latest?.activity).toBe('v3')
  })

  it('returns null when no plan exists for a group+planId', async () => {
    const result = await getLatestPlanVersion(GROUP, crypto.randomUUID())
    expect(result).toBeNull()
  })
})

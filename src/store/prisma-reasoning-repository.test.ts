import { describe, expect, it } from 'vitest'
import { PrismaReasoningRepository } from './prisma-reasoning-repository.js'

describe('PrismaReasoningRepository', () => {
  it('uses Phase 1 repositories for group-scoped E2 state', async () => {
    const repository = new PrismaReasoningRepository()
    const suffix = crypto.randomUUID()
    const groupId = `reasoning-${suffix}`
    const personId = `person-${suffix}`
    await repository.appendTranscript({ groupId, sender: personId, text: 'climbing sounds fun', timestamp: '2026-08-02T14:00:00-07:00' })
    await repository.mergeGroupProfile({ group_id: groupId, shared_interests: ['climbing'], initiators: [], followers: [], sentiment_notes: [], updated_at: Date.now() })
    await repository.mergePersonProfile({ person_id: personId, group_id: groupId, name: 'Sam', interests: [{ activity: 'climbing', recency: Date.now(), confidence: 0.6, mention_count: 2 }], budget_signals: [], constraints: [], availability_mentions: [], updated_at: Date.now() })
    await repository.saveNextPlan(groupId, { plan_id: crypto.randomUUID(), version: 1, status: 'proposed', activity: 'climbing', venue: { name: 'Peak', source_tool: 'fixture', ref_id: 'peak' }, datetime: '2026-08-02T14:00:00-07:00', cost_tier: 'low', attendees: { [personId]: 'pending' }, rationale: 'Repeated interest.' })
    expect(await repository.readTranscript(groupId, 10)).toHaveLength(1)
    expect(await repository.getPersonProfiles(groupId)).toMatchObject([{ person_id: personId }])
    expect(await repository.getCurrentPlan(groupId)).toMatchObject({ version: 1, status: 'proposed' })
  })
})

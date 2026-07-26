import { describe, expect, it } from 'vitest'
import { synthesizePlan } from '../../src/synthesis/synthesize.js'
import { InMemoryReasoningRepository } from '../../src/store/in-memory-repository.js'
import { QueueClaudeClient, plan } from './helpers.js'

const profile = { group_id: 'g1', shared_interests: [], initiators: [], followers: [], sentiment_notes: [], updated_at: 1 }
const candidate = { activity: 'climbing gym session', venue: { name: 'Peak', source_tool: 'merge_search_venues', ref_id: 'peak-1' }, datetime: '2026-08-02T14:00:00-07:00', cost_tier: 'low' as const }
describe('plan synthesis', () => {
  it('stores versioned plans and rejects invalid revisions', async () => {
    const repo = new InMemoryReasoningRepository()
    const client = new QueueClaudeClient([{ plan: plan(1), chatMessage: 'How about climbing?' }, { plan: plan(2), chatMessage: 'Updated.' }])
    await synthesizePlan(client, repo, { groupId: 'g1', groupProfile: profile, personProfiles: [], candidates: [candidate] })
    await expect(synthesizePlan(client, repo, { groupId: 'g1', groupProfile: profile, personProfiles: [], candidates: [candidate] })).resolves.toMatchObject({ plan: { version: 2 } })
  })
  it('rejects cross-group profiles and model-invented candidates', async () => {
    const repo = new InMemoryReasoningRepository()
    const crossGroup = new QueueClaudeClient([])
    await expect(synthesizePlan(crossGroup, repo, { groupId: 'g1', groupProfile: { ...profile, group_id: 'other' }, personProfiles: [], candidates: [candidate] })).rejects.toThrow('target group')
    const invented = new QueueClaudeClient([{ plan: { ...plan(1), venue: { name: 'Invented', source_tool: 'merge_search_venues', ref_id: 'bad' } }, chatMessage: 'Try this.' }])
    await expect(synthesizePlan(invented, repo, { groupId: 'g1', groupProfile: profile, personProfiles: [], candidates: [candidate] })).rejects.toThrow('validated candidate')
  })
})

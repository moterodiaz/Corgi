import { describe, expect, it } from 'vitest'
import { extractAndMergeContext, shouldExtractContext } from '../../src/context/extractor.js'
import { InMemoryReasoningRepository } from '../../src/store/in-memory-repository.js'
import { QueueClaudeClient, iso } from './helpers.js'

const person = (count: number) => ({ person_id: 'sam', group_id: 'g1', name: 'Sam', interests: [{ activity: 'climbing', confidence: count === 1 ? 0.3 : 0.8, mention_count: count, recency: Date.parse(iso) }], budget_signals: [], constraints: [], availability_mentions: [], updated_at: Date.parse(iso) })
const group = { group_id: 'g1', shared_interests: [], initiators: [], followers: [], sentiment_notes: [], updated_at: Date.parse(iso) }
const entries = [{ groupId: 'g1', sender: 'sam', text: 'climbing', timestamp: iso }]
describe('context extraction', () => {
  it('triggers on either message count or elapsed time', () => {
    expect(shouldExtractContext({ messagesSinceLastExtraction: 5, lastExtractionAt: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-01-01T00:00:00Z'), messageThreshold: 5, intervalMs: 1_000 })).toBe(true)
    expect(shouldExtractContext({ messagesSinceLastExtraction: 0, lastExtractionAt: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-01-01T00:00:02Z'), messageThreshold: 5, intervalMs: 1_000 })).toBe(true)
  })
  it('merges repeated evidence and rejects cross-group or duplicate deltas', async () => {
    const repo = new InMemoryReasoningRepository()
    const client = new QueueClaudeClient([{ group, people: [person(1)] }, { group, people: [person(2)] }])
    await extractAndMergeContext(client, repo, 'g1', entries)
    await extractAndMergeContext(client, repo, 'g1', entries)
    expect((await repo.getPersonProfiles('g1'))[0]?.interests[0]).toMatchObject({ mention_count: 3 })
    const duplicate = new QueueClaudeClient([{ group, people: [person(1), person(1)] }])
    await expect(extractAndMergeContext(duplicate, repo, 'g1', entries)).rejects.toThrow('one delta')
    const wrongGroup = new QueueClaudeClient([{ group: { ...group, group_id: 'other' }, people: [] }])
    await expect(extractAndMergeContext(wrongGroup, repo, 'g1', entries)).rejects.toThrow('crossed group boundary')
  })
})

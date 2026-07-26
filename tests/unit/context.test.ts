import { describe, expect, it } from 'vitest';
import { extractAndMergeContext, shouldExtractContext } from '../../src/context/extractor.js';
import { InMemoryReasoningRepository } from '../../src/store/in-memory-repository.js';
import { QueueClaudeClient, iso } from './helpers.js';

const signal = (mentions: number) => ({ value: 'climbing', confidence: mentions === 1 ? 0.25 : 0.8, mentions, observedAt: iso });
describe('context extraction', () => {
  it('triggers on either message count or elapsed time, not only both', () => {
    expect(shouldExtractContext({ messagesSinceLastExtraction: 5, lastExtractionAt: new Date('2026-01-01T00:00:00.000Z'), now: new Date('2026-01-01T00:00:00.000Z'), messageThreshold: 5, intervalMs: 1_000 })).toBe(true);
    expect(shouldExtractContext({ messagesSinceLastExtraction: 0, lastExtractionAt: new Date('2026-01-01T00:00:00.000Z'), now: new Date('2026-01-01T00:00:02.000Z'), messageThreshold: 5, intervalMs: 1_000 })).toBe(true);
    expect(shouldExtractContext({ messagesSinceLastExtraction: 1, lastExtractionAt: new Date('2026-01-01T00:00:00.000Z'), now: new Date('2026-01-01T00:00:00.500Z'), messageThreshold: 5, intervalMs: 1_000 })).toBe(false);
  });
  it('merges repeated evidence, making three mentions stronger than a single mention', async () => {
    const repo = new InMemoryReasoningRepository();
    const client = new QueueClaudeClient([
      { group: { groupId: 'g1', sharedInterests: [], runningJokes: [], initiators: [], pastHangoutSentiment: [] }, people: [{ groupId: 'g1', personId: 'sam', interests: [signal(1)], budgetSignals: [], constraints: [], availability: [] }] },
      { group: { groupId: 'g1', sharedInterests: [], runningJokes: [], initiators: [], pastHangoutSentiment: [] }, people: [{ groupId: 'g1', personId: 'sam', interests: [signal(2)], budgetSignals: [], constraints: [], availability: [] }] },
    ]);
    const entries = [{ groupId: 'g1', senderId: 'sam', text: 'climbing', sentAt: iso }];
    await extractAndMergeContext(client, repo, 'g1', entries);
    await extractAndMergeContext(client, repo, 'g1', entries);
    const sam = (await repo.getPersonProfiles('g1'))[0];
    expect(sam?.interests[0]).toMatchObject({ mentions: 3 });
    expect(sam?.interests[0]?.confidence).toBeGreaterThan(0.25);
    expect(client.requests[0]?.user).toContain('<untrusted_transcript>');
  });
  it('rejects a Claude delta that attempts to write another group', async () => {
    const repo = new InMemoryReasoningRepository();
    const client = new QueueClaudeClient([{ group: { groupId: 'other', sharedInterests: [], runningJokes: [], initiators: [], pastHangoutSentiment: [] }, people: [] }]);
    await expect(extractAndMergeContext(client, repo, 'g1', [{ groupId: 'g1', senderId: 'sam', text: 'hello', sentAt: iso }])).rejects.toThrow('crossed group boundary');
  });
  it('rejects duplicate deltas for one person instead of racing two profile merges', async () => {
    const repo = new InMemoryReasoningRepository();
    const person = { groupId: 'g1', personId: 'sam', interests: [signal(1)], budgetSignals: [], constraints: [], availability: [] };
    const client = new QueueClaudeClient([{ group: { groupId: 'g1', sharedInterests: [], runningJokes: [], initiators: [], pastHangoutSentiment: [] }, people: [person, person] }]);
    await expect(extractAndMergeContext(client, repo, 'g1', [{ groupId: 'g1', senderId: 'sam', text: 'hello', sentAt: iso }])).rejects.toThrow('one delta');
    expect(await repo.getPersonProfiles('g1')).toEqual([]);
  });
});

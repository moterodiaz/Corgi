import { describe, expect, it } from 'vitest';
import { synthesizePlan } from '../../src/synthesis/synthesize.js';
import { InMemoryReasoningRepository } from '../../src/store/in-memory-repository.js';
import { QueueClaudeClient, plan } from './helpers.js';

const profiles = { groupId: 'g1', sharedInterests: [], runningJokes: [], initiators: [], pastHangoutSentiment: [] };
const candidate = { activity: 'climbing gym session', venue: { name: 'Peak', source_tool: 'merge_search_venues', ref_id: 'peak-1' }, datetime: '2026-08-02T14:00:00-07:00', cost_tier: 'low' as const };
describe('plan synthesis', () => {
  it('stores a first synthesized plan at version 1 and a revision at version 2', async () => {
    const repo = new InMemoryReasoningRepository();
    const client = new QueueClaudeClient([{ plan: plan(1), chatMessage: 'How about climbing?' }, { plan: plan(2), chatMessage: 'Updated time.' }]);
    await synthesizePlan(client, repo, { groupId: 'g1', groupProfile: profiles, personProfiles: [], candidates: [candidate] });
    const revised = await synthesizePlan(client, repo, { groupId: 'g1', groupProfile: profiles, personProfiles: [], candidates: [candidate] });
    expect(revised.plan.version).toBe(2);
    expect((await repo.getCurrentPlan('g1'))?.version).toBe(2);
  });
  it('rejects a revision that replaces a plan ID or skips a version', async () => {
    const repo = new InMemoryReasoningRepository();
    await repo.saveNextPlan('g1', plan(1));
    const invalid = { ...plan(3), plan_id: '660e8400-e29b-41d4-a716-446655440000' };
    const client = new QueueClaudeClient([{ plan: invalid, chatMessage: 'Wrong revision.' }]);
    await expect(synthesizePlan(client, repo, { groupId: 'g1', groupProfile: profiles, personProfiles: [], candidates: [candidate] })).rejects.toThrow('version 2');
  });
  it('refuses profile data from another group before calling Claude', async () => {
    const repo = new InMemoryReasoningRepository();
    const client = new QueueClaudeClient([]);
    await expect(synthesizePlan(client, repo, { groupId: 'g1', groupProfile: { ...profiles, groupId: 'g2' }, personProfiles: [], candidates: [candidate] })).rejects.toThrow('target group');
    expect(client.requests).toHaveLength(0);
  });
});

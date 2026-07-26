import { describe, expect, it } from 'vitest';
import { applyFeedbackDiff } from '../../src/feedback/diff.js';
import { InMemoryReasoningRepository } from '../../src/store/in-memory-repository.js';
import { QueueClaudeClient, plan } from './helpers.js';

const withCurrentPlan = async () => { const repo = new InMemoryReasoningRepository(); await repo.saveNextPlan('g1', plan()); return repo; };
describe('feedback diff layer', () => {
  it('applies a hard constraint as a minimal versioned patch', async () => {
    const repo = await withCurrentPlan();
    const client = new QueueClaudeClient([{ kind: 'hard_constraint_change', patch: { datetime: '2026-08-03T14:00:00-07:00' } }]);
    const result = await applyFeedbackDiff(client, repo, { groupId: 'g1', feedback: 'Sam cannot do Saturday.' });
    expect(result).toMatchObject({ kind: 'hard_constraint_change', requiresSynthesis: false, plan: { version: 2, datetime: '2026-08-03T14:00:00-07:00', activity: 'climbing gym session' } });
  });
  it('supports non-time hard constraints and preserves RSVPs absent from a partial update', async () => {
    const repo = await withCurrentPlan();
    const client = new QueueClaudeClient([{ kind: 'hard_constraint_change', patch: { venue: { name: 'Accessible Peak', source_tool: 'merge_search_venues', ref_id: 'peak-accessible' }, attendees: { sam: 'no' } } }]);
    const result = await applyFeedbackDiff(client, repo, { groupId: 'g1', feedback: 'Sam needs an accessible venue and cannot attend.' });
    expect(result).toMatchObject({ plan: { venue: { name: 'Accessible Peak' }, attendees: { sam: 'no', jess: 'pending' } } });
  });
  it('applies a preference nudge without re-deriving unaffected fields', async () => {
    const repo = await withCurrentPlan();
    const client = new QueueClaudeClient([{ kind: 'preference_nudge', patch: { cost_tier: 'free', rationale: 'Budget-friendly.' } }]);
    const result = await applyFeedbackDiff(client, repo, { groupId: 'g1', feedback: 'Can we do something cheaper?' });
    expect(result).toMatchObject({ kind: 'preference_nudge', plan: { version: 2, cost_tier: 'free', venue: { name: 'Peak' } } });
  });
  it('leaves plan state untouched on full reject and requests a fresh synthesis', async () => {
    const repo = await withCurrentPlan();
    const client = new QueueClaudeClient([{ kind: 'full_reject', reason: 'The group wants a completely different activity.' }]);
    const result = await applyFeedbackDiff(client, repo, { groupId: 'g1', feedback: 'Let us do something totally different.' });
    expect(result).toEqual({ kind: 'full_reject', requiresSynthesis: true, reason: 'The group wants a completely different activity.' });
    expect((await repo.getCurrentPlan('g1'))?.version).toBe(1);
  });
  it('rejects a malformed hard-constraint diff with no changed field', async () => {
    const repo = await withCurrentPlan();
    const client = new QueueClaudeClient([{ kind: 'hard_constraint_change', patch: {} }]);
    await expect(applyFeedbackDiff(client, repo, { groupId: 'g1', feedback: 'Sam cannot go.' })).rejects.toThrow();
  });
});

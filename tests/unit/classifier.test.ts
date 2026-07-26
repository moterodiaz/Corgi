import { describe, expect, it } from 'vitest';
import { classifyShouldSpeak } from '../../src/claude/classifier.js';
import { QueueClaudeClient, iso } from './helpers.js';

const transcript = [{ groupId: 'g1', senderId: 'sam', text: 'we should hang out this weekend', sentAt: iso }];
describe('should-I-speak classifier', () => {
  it.each([['propose'], ['clarifying'], ['silent']] as const)('accepts the structured %s decision', async (decision) => {
    const client = new QueueClaudeClient([{ decision, rationale: 'Model judgment.' }]);
    await expect(classifyShouldSpeak(client, { transcript, personProfiles: [] })).resolves.toMatchObject({ decision });
  });
  it('instructs a silence-first decision around each documented signal', async () => {
    const client = new QueueClaudeClient([{ decision: 'silent', rationale: 'Ambiguous chat.' }]);
    await classifyShouldSpeak(client, { transcript, personProfiles: [] });
    const prompt = client.requests[0]?.system ?? '';
    expect(prompt).toContain('Default to silent');
    expect(prompt).toContain('Planning language');
    expect(prompt).toContain('lull');
    expect(prompt).toContain('unresolved disagreement');
    expect(prompt).toContain('insufficient');
  });
});

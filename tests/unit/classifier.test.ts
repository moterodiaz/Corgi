import { describe, expect, it } from 'vitest'
import { classifyShouldSpeak } from '../../src/claude/classifier.js'
import { QueueClaudeClient, iso } from './helpers.js'

const transcript = [{ groupId: 'g1', sender: 'sam', text: 'we should hang out this weekend', timestamp: iso }]
describe('should-I-speak classifier', () => {
  it.each(['propose', 'clarifying', 'silent'] as const)('accepts the structured %s decision', async (decision) => {
    const client = new QueueClaudeClient([{ decision, rationale: 'Model judgment.' }])
    await expect(classifyShouldSpeak(client, { transcript, personProfiles: [] })).resolves.toMatchObject({ decision })
  })
  it('uses silence-first instructions and separates raw transcript from profiles', async () => {
    const client = new QueueClaudeClient([{ decision: 'silent', rationale: 'Ambiguous chat.' }])
    await classifyShouldSpeak(client, { transcript, personProfiles: [] })
    expect(client.requests[0]?.system).toContain('Default to silent')
    expect(client.requests[0]?.system).toContain('unresolved disagreement')
    expect(client.requests[0]?.user).toContain('<trusted_profiles>')
    expect(client.requests[0]?.user).toContain('<untrusted_transcript>')
  })
})

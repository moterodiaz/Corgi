import { describe, expect, it } from 'vitest'
import { ClaudeOutputError, ClaudeStructuredClient } from '../../src/claude/client.js'
import { speakDecisionSchema } from '../../src/claude/classifier.js'
import { CLASSIFIER_MODEL } from '../../src/claude/models.js'

const request = { model: CLASSIFIER_MODEL, system: 'system', user: 'chat', schema: speakDecisionSchema, toolName: 'decision' }
describe('ClaudeStructuredClient', () => {
  it('forces a tool call and validates its output before returning it', async () => {
    const client = new ClaudeStructuredClient({ createMessage: async () => ({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'decision', input: { decision: 'silent', rationale: 'No clear opening.' } }] }) } as never)
    await expect(client.call(request)).resolves.toEqual({ decision: 'silent', rationale: 'No clear opening.' })
  })
  it('rejects malformed or missing structured model output', async () => {
    const malformed = new ClaudeStructuredClient({ createMessage: async () => ({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'decision', input: { decision: 'loud' } }] }) } as never)
    await expect(malformed.call(request)).rejects.toBeInstanceOf(ClaudeOutputError)
    const missing = new ClaudeStructuredClient({ createMessage: async () => ({ content: [] }) } as never)
    await expect(missing.call(request)).rejects.toBeInstanceOf(ClaudeOutputError)
  })
})

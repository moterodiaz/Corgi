import Anthropic from '@anthropic-ai/sdk';
import nock from 'nock';
import { describe, expect, it, afterEach } from 'vitest';
import { AnthropicStructuredClient, ClaudeOutputError } from '../../src/claude/client.js';
import { speakDecisionSchema } from '../../src/claude/classifier.js';
import { CLAUDE_MODELS } from '../../src/claude/models.js';

const response = (input: unknown) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: CLAUDE_MODELS.classifier, content: [{ type: 'tool_use', id: 'toolu_1', name: 'decision', input }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
describe('AnthropicStructuredClient', () => {
  afterEach(() => { nock.cleanAll(); });
  it('forces a tool call and returns Zod-validated output from the HTTP API', async () => {
    const scope = nock('https://api.anthropic.com').post('/v1/messages').reply(200, response({ decision: 'silent', rationale: 'No clear opening.' }));
    const client = new AnthropicStructuredClient(new Anthropic({ apiKey: 'test-key' }));
    await expect(client.call({ model: CLAUDE_MODELS.classifier, system: 'system', user: 'chat', schema: speakDecisionSchema, toolName: 'decision' })).resolves.toEqual({ decision: 'silent', rationale: 'No clear opening.' });
    expect(scope.isDone()).toBe(true);
  });
  it('rejects malformed structured model output rather than passing it to business logic', async () => {
    nock('https://api.anthropic.com').post('/v1/messages').reply(200, response({ decision: 'loud', rationale: '' }));
    const client = new AnthropicStructuredClient(new Anthropic({ apiKey: 'test-key' }));
    await expect(client.call({ model: CLAUDE_MODELS.classifier, system: 'system', user: 'chat', schema: speakDecisionSchema, toolName: 'decision' })).rejects.toBeInstanceOf(ClaudeOutputError);
  });
});

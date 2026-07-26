import type { StructuredClaudeClient, StructuredClaudeRequest } from '../../src/claude/client.js'
import { z } from 'zod';
import type { PlanObject } from '../../src/types/index.js'

export class QueueClaudeClient implements StructuredClaudeClient {
  readonly requests: StructuredClaudeRequest<z.ZodTypeAny>[] = []
  constructor(private readonly replies: unknown[]) {}
  async call<T extends z.ZodTypeAny>(request: StructuredClaudeRequest<T>): Promise<z.infer<T>> {
    this.requests.push(request)
    return request.schema.parse(this.replies.shift())
  }
}

export const iso = '2026-08-02T14:00:00-07:00'
export const plan = (version = 1): PlanObject => ({
  plan_id: '550e8400-e29b-41d4-a716-446655440000', version, status: version === 1 ? 'proposed' : 'revising',
  activity: 'climbing gym session', venue: { name: 'Peak', source_tool: 'merge_search_venues', ref_id: 'peak-1' },
  datetime: iso, cost_tier: 'low', attendees: { sam: 'yes', jess: 'pending' }, rationale: 'Low cost and Sam likes climbing.',
});

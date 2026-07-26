import { describe, expect, it } from 'vitest';
import { InMemoryReasoningRepository } from '../../src/store/in-memory-repository.js';
import { plan } from './helpers.js';

describe('reasoning repository plan invariant', () => {
  it('rejects a versioned plan write that swaps the plan identity', async () => {
    const repository = new InMemoryReasoningRepository();
    await repository.saveNextPlan('g1', plan(1));
    await expect(repository.saveNextPlan('g1', { ...plan(2), plan_id: '660e8400-e29b-41d4-a716-446655440000' })).rejects.toThrow('retain the existing plan ID');
  });
});

import { describe, expect, it } from 'vitest';
import { evaluateSpeakClassifier } from '../../src/claude/evaluation.js';
import { E2_EVAL_CASES } from '../fixtures/e2-eval-corpus.js';

describe('E2 evaluation flywheel', () => {
  it('contains 100 balanced, labeled evaluation cases', () => {
    expect(E2_EVAL_CASES).toHaveLength(100);
    for (const scenario of ['ready_to_plan', 'insufficient_context', 'unrelated_chat', 'unresolved_disagreement', 'prompt_injection']) {
      expect(E2_EVAL_CASES.filter((testCase) => testCase.scenario === scenario)).toHaveLength(20);
    }
  });

  it('reports overall, per-scenario, and failure-level classifier metrics', async () => {
    const result = await evaluateSpeakClassifier(E2_EVAL_CASES, async (testCase) => ({ decision: testCase.expected, rationale: 'Gold evaluation response.' }));
    expect(result).toMatchObject({ total: 100, correct: 100, accuracy: 1, failures: [] });
    expect(result.byScenario.prompt_injection).toMatchObject({ total: 20, correct: 20, accuracy: 1 });
    expect(result.byDecision).toMatchObject({ silent: { expected: 60, predicted: 60, precision: 1, recall: 1 }, clarifying: { expected: 20, predicted: 20, precision: 1, recall: 1 }, propose: { expected: 20, predicted: 20, precision: 1, recall: 1 } });
  });

  it('attributes a wrong decision to the exact scenario and case', async () => {
    const first = E2_EVAL_CASES[0]
    if (!first) throw new Error('Evaluation corpus is unexpectedly empty')
    const result = await evaluateSpeakClassifier(E2_EVAL_CASES.slice(0, 2), async (testCase) => ({ decision: testCase.id === first.id ? 'silent' : testCase.expected, rationale: 'Test response.' }));
    expect(result).toMatchObject({ total: 2, correct: 1, accuracy: 0.5, failures: [{ id: first.id, scenario: 'ready_to_plan', expected: 'propose', actual: 'silent' }] });
    expect(result.byDecision.propose).toMatchObject({ expected: 1, predicted: 0, correct: 0, precision: 0, recall: 0 });
  });
});

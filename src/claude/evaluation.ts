import { classifyShouldSpeak, type SpeakDecision } from './classifier.js';
import type { StructuredClaudeClient } from './client.js';
import type { GroupProfile, PersonProfile, TranscriptEntry } from '../types/index.js';

export type E2EvalLabel = 'silent' | 'clarifying' | 'propose';
export type E2EvalScenario = 'ready_to_plan' | 'insufficient_context' | 'unrelated_chat' | 'unresolved_disagreement' | 'prompt_injection';
export interface E2EvalCase {
  id: string;
  scenario: E2EvalScenario;
  expected: E2EvalLabel;
  transcript: TranscriptEntry[];
  groupProfile?: GroupProfile;
  personProfiles: PersonProfile[];
}

export interface E2EvaluationResult {
  total: number;
  correct: number;
  accuracy: number;
  byScenario: Record<E2EvalScenario, { total: number; correct: number; accuracy: number }>;
  byDecision: Record<E2EvalLabel, { expected: number; predicted: number; correct: number; precision: number; recall: number }>;
  failures: Array<{ id: string; scenario: E2EvalScenario; expected: E2EvalLabel; actual: E2EvalLabel }>;
}

export const evaluateSpeakClassifier = async (
  cases: readonly E2EvalCase[],
  predict: (testCase: E2EvalCase) => Promise<SpeakDecision>,
): Promise<E2EvaluationResult> => {
  const scenarios: E2EvalScenario[] = ['ready_to_plan', 'insufficient_context', 'unrelated_chat', 'unresolved_disagreement', 'prompt_injection'];
  const byScenario = Object.fromEntries(scenarios.map((scenario) => [scenario, { total: 0, correct: 0, accuracy: 0 }])) as E2EvaluationResult['byScenario'];
  const labels: E2EvalLabel[] = ['silent', 'clarifying', 'propose'];
  const byDecision = Object.fromEntries(labels.map((label) => [label, { expected: 0, predicted: 0, correct: 0, precision: 0, recall: 0 }])) as E2EvaluationResult['byDecision'];
  const failures: E2EvaluationResult['failures'] = [];
  for (const testCase of cases) {
    const actual = (await predict(testCase)).decision;
    const bucket = byScenario[testCase.scenario];
    bucket.total += 1;
    byDecision[testCase.expected].expected += 1;
    byDecision[actual].predicted += 1;
    if (actual === testCase.expected) bucket.correct += 1;
    if (actual === testCase.expected) byDecision[actual].correct += 1;
    else failures.push({ id: testCase.id, scenario: testCase.scenario, expected: testCase.expected, actual });
  }
  for (const bucket of Object.values(byScenario)) bucket.accuracy = bucket.total === 0 ? 0 : bucket.correct / bucket.total;
  for (const bucket of Object.values(byDecision)) {
    bucket.precision = bucket.predicted === 0 ? 0 : bucket.correct / bucket.predicted;
    bucket.recall = bucket.expected === 0 ? 0 : bucket.correct / bucket.expected;
  }
  return { total: cases.length, correct: cases.length - failures.length, accuracy: cases.length === 0 ? 0 : (cases.length - failures.length) / cases.length, byScenario, byDecision, failures };
};

export const evaluateClaudeSpeakClassifier = async (client: StructuredClaudeClient, cases: readonly E2EvalCase[]): Promise<E2EvaluationResult> =>
  evaluateSpeakClassifier(cases, async (testCase) => classifyShouldSpeak(client, testCase.groupProfile === undefined
    ? { transcript: testCase.transcript, personProfiles: testCase.personProfiles }
    : { transcript: testCase.transcript, groupProfile: testCase.groupProfile, personProfiles: testCase.personProfiles }));

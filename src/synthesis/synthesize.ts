import { z } from 'zod';
import type { StructuredClaudeClient } from '../claude/client.js';
import { CLAUDE_MODELS } from '../claude/models.js';
import { planObjectSchema, type GroupProfile, type PersonProfile } from '../types/index.js';
import type { ReasoningRepository } from '../store/repository.js';

export const candidateSchema = z.object({
  activity: z.string().min(1),
  venue: z.object({ name: z.string().min(1), source_tool: z.string().min(1), ref_id: z.string().min(1) }),
  datetime: z.iso.datetime({ offset: true }),
  cost_tier: z.enum(['free', 'low', 'medium', 'high']),
});
export const synthesisResultSchema = z.object({ plan: planObjectSchema, chatMessage: z.string().min(1) });
export type SynthesisResult = z.infer<typeof synthesisResultSchema>;

const systemPrompt = `Create a concrete, considerate hangout plan from structured profiles and validated candidate venues. Never confirm a plan based on raw text; produce proposed or revising only. Cite evidence conservatively in the rationale and preserve unaffected current-plan fields on a revision.`;

export const synthesizePlan = async (client: StructuredClaudeClient, repository: ReasoningRepository, input: {
  groupId: string; groupProfile: GroupProfile; personProfiles: PersonProfile[]; candidates: z.infer<typeof candidateSchema>[];
}): Promise<SynthesisResult> => {
  if (input.groupProfile.groupId !== input.groupId || input.personProfiles.some((person) => person.groupId !== input.groupId)) {
    throw new Error('Profiles must belong to the target group');
  }
  const currentPlan = await repository.getCurrentPlan(input.groupId);
  const candidates = z.array(candidateSchema).parse(input.candidates);
  const output = await client.call({
    model: CLAUDE_MODELS.reasoning, system: systemPrompt,
    user: `<trusted_planning_state>${JSON.stringify({ groupId: input.groupId, groupProfile: input.groupProfile, personProfiles: input.personProfiles, candidates, currentPlan })}</trusted_planning_state>`, schema: synthesisResultSchema, toolName: 'synthesize_plan',
  });
  const expectedVersion = currentPlan ? currentPlan.version + 1 : 1;
  if (output.plan.version !== expectedVersion) throw new Error(`Synthesis must produce plan version ${String(expectedVersion)}`);
  if (currentPlan && output.plan.plan_id !== currentPlan.plan_id) throw new Error('A revision must retain the existing plan ID');
  if (output.plan.status !== (currentPlan ? 'revising' : 'proposed')) throw new Error('Synthesis returned an invalid plan status');
  const matchesCandidate = candidates.some((candidate) => candidate.activity === output.plan.activity && candidate.venue.name === output.plan.venue.name && candidate.venue.source_tool === output.plan.venue.source_tool && candidate.venue.ref_id === output.plan.venue.ref_id && candidate.datetime === output.plan.datetime && candidate.cost_tier === output.plan.cost_tier);
  if (!matchesCandidate) throw new Error('Synthesis must use a validated candidate');
  await repository.saveNextPlan(input.groupId, output.plan);
  return output;
};

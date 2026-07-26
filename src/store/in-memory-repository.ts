import type { GroupProfile, PersonProfile, PlanObject, ProfileSignal, TranscriptEntry } from '../types/index.js';
import type { ReasoningRepository } from './repository.js';

const mergeSignals = (stored: ProfileSignal[], incoming: ProfileSignal[]): ProfileSignal[] => {
  const signals = new Map(stored.map((signal) => [signal.value.toLowerCase(), signal]));
  for (const next of incoming) {
    const key = next.value.toLowerCase();
    const previous = signals.get(key);
    if (!previous) { signals.set(key, next); continue; }
    const mentions = previous.mentions + next.mentions;
    const newer = Date.parse(next.observedAt) >= Date.parse(previous.observedAt) ? next : previous;
    signals.set(key, {
      value: newer.value,
      mentions,
      observedAt: newer.observedAt,
      confidence: Math.min(1, (previous.confidence * previous.mentions + next.confidence * next.mentions) / mentions),
    });
  }
  return [...signals.values()];
};

export class InMemoryReasoningRepository implements ReasoningRepository {
  private readonly transcript = new Map<string, TranscriptEntry[]>();
  private readonly groups = new Map<string, GroupProfile>();
  private readonly people = new Map<string, PersonProfile>();
  private readonly plans = new Map<string, PlanObject[]>();

  async appendTranscript(entry: TranscriptEntry): Promise<void> {
    this.transcript.set(entry.groupId, [...(this.transcript.get(entry.groupId) ?? []), entry]);
  }
  async readTranscript(groupId: string, limit: number): Promise<TranscriptEntry[]> {
    return (this.transcript.get(groupId) ?? []).slice(-limit);
  }
  async getGroupProfile(groupId: string): Promise<GroupProfile | undefined> { return this.groups.get(groupId); }
  async mergeGroupProfile(incoming: GroupProfile): Promise<GroupProfile> {
    const prior = this.groups.get(incoming.groupId);
    const result: GroupProfile = !prior ? incoming : {
      groupId: incoming.groupId,
      sharedInterests: mergeSignals(prior.sharedInterests, incoming.sharedInterests),
      runningJokes: mergeSignals(prior.runningJokes, incoming.runningJokes),
      initiators: mergeSignals(prior.initiators, incoming.initiators),
      pastHangoutSentiment: mergeSignals(prior.pastHangoutSentiment, incoming.pastHangoutSentiment),
    };
    this.groups.set(incoming.groupId, result); return result;
  }
  async getPersonProfiles(groupId: string): Promise<PersonProfile[]> {
    return [...this.people.values()].filter((profile) => profile.groupId === groupId);
  }
  async mergePersonProfile(incoming: PersonProfile): Promise<PersonProfile> {
    const key = `${incoming.groupId}:${incoming.personId}`; const prior = this.people.get(key);
    const result: PersonProfile = !prior ? incoming : {
      groupId: incoming.groupId, personId: incoming.personId,
      interests: mergeSignals(prior.interests, incoming.interests),
      budgetSignals: mergeSignals(prior.budgetSignals, incoming.budgetSignals),
      constraints: mergeSignals(prior.constraints, incoming.constraints),
      availability: mergeSignals(prior.availability, incoming.availability),
    };
    this.people.set(key, result); return result;
  }
  async getCurrentPlan(groupId: string): Promise<PlanObject | undefined> { return this.plans.get(groupId)?.at(-1); }
  async saveNextPlan(groupId: string, plan: PlanObject): Promise<PlanObject> {
    const existing = this.plans.get(groupId) ?? []; const current = existing.at(-1);
    if (current && plan.version !== current.version + 1) throw new Error('Plan version must increment exactly once');
    if (current && plan.plan_id !== current.plan_id) throw new Error('Plan revisions must retain the existing plan ID');
    if (!current && plan.version !== 1) throw new Error('Initial plan version must be 1');
    this.plans.set(groupId, [...existing, plan]); return plan;
  }
}

import type { GroupProfile, PersonProfile, PlanObject, TranscriptEntry } from '../types/index.js'
import type { ReasoningRepository } from './repository.js'

const mergeInterests = (
  stored: PersonProfile['interests'],
  incoming: PersonProfile['interests'],
): PersonProfile['interests'] => {
  const byActivity = new Map(stored.map((interest) => [interest.activity, interest]))
  for (const interest of incoming) {
    const prior = byActivity.get(interest.activity)
    if (!prior) byActivity.set(interest.activity, interest)
    else {
      const mention_count = prior.mention_count + interest.mention_count
      byActivity.set(interest.activity, {
        activity: interest.activity,
        mention_count,
        recency: Math.max(prior.recency, interest.recency),
        confidence: Math.min(1, (prior.confidence * prior.mention_count + interest.confidence * interest.mention_count) / mention_count),
      })
    }
  }
  return [...byActivity.values()]
}

export class InMemoryReasoningRepository implements ReasoningRepository {
  private readonly transcript = new Map<string, TranscriptEntry[]>()
  private readonly groups = new Map<string, GroupProfile>()
  private readonly people = new Map<string, PersonProfile>()
  private readonly plans = new Map<string, PlanObject[]>()

  async appendTranscript(entry: TranscriptEntry): Promise<void> {
    this.transcript.set(entry.groupId, [...(this.transcript.get(entry.groupId) ?? []), entry])
  }
  async readTranscript(groupId: string, limit: number): Promise<TranscriptEntry[]> {
    return (this.transcript.get(groupId) ?? []).slice(-limit)
  }
  async getGroupProfile(groupId: string): Promise<GroupProfile | undefined> {
    return this.groups.get(groupId)
  }
  async mergeGroupProfile(incoming: GroupProfile): Promise<GroupProfile> {
    const prior = this.groups.get(incoming.group_id)
    const result: GroupProfile = !prior ? incoming : {
      group_id: incoming.group_id,
      updated_at: Math.max(prior.updated_at, incoming.updated_at),
      shared_interests: [...new Set([...prior.shared_interests, ...incoming.shared_interests])],
      initiators: [...new Set([...prior.initiators, ...incoming.initiators])],
      followers: [...new Set([...prior.followers, ...incoming.followers])],
      sentiment_notes: [...prior.sentiment_notes, ...incoming.sentiment_notes],
    }
    this.groups.set(incoming.group_id, result)
    return result
  }
  async getPersonProfiles(groupId: string): Promise<PersonProfile[]> {
    return [...this.people.values()].filter((profile) => profile.group_id === groupId)
  }
  async mergePersonProfile(incoming: PersonProfile): Promise<PersonProfile> {
    const key = `${incoming.group_id}:${incoming.person_id}`
    const prior = this.people.get(key)
    const result: PersonProfile = !prior ? incoming : {
      person_id: incoming.person_id,
      group_id: incoming.group_id,
      name: incoming.name,
      updated_at: Math.max(prior.updated_at, incoming.updated_at),
      interests: mergeInterests(prior.interests, incoming.interests),
      budget_signals: [...new Set([...prior.budget_signals, ...incoming.budget_signals])],
      constraints: [...new Set([...prior.constraints, ...incoming.constraints])],
      availability_mentions: [...prior.availability_mentions, ...incoming.availability_mentions],
    }
    this.people.set(key, result)
    return result
  }
  async getCurrentPlan(groupId: string): Promise<PlanObject | undefined> {
    return this.plans.get(groupId)?.at(-1)
  }
  async saveNextPlan(groupId: string, plan: PlanObject): Promise<PlanObject> {
    const existing = this.plans.get(groupId) ?? []
    const current = existing.at(-1)
    if (current && plan.version !== current.version + 1) throw new Error('Plan version must increment exactly once')
    if (current && plan.plan_id !== current.plan_id) throw new Error('Plan revisions must retain the existing plan ID')
    if (!current && plan.version !== 1) throw new Error('Initial plan version must be 1')
    this.plans.set(groupId, [...existing, plan])
    return plan
  }
}

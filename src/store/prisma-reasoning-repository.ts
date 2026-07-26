import {
  getGroupProfile,
  getPersonProfilesForGroup,
  upsertGroupProfile,
  upsertPersonProfile,
} from './profile-repo.js'
import { createPlanVersion, getCurrentPlanForGroup } from './plan-repo.js'
import { appendTranscriptEntry, getTranscriptByGroup } from './transcript-repo.js'
import type { GroupProfile, PersonProfile, PlanObject, TranscriptEntry } from '../types/index.js'
import type { ReasoningRepository } from './repository.js'

/** Production E2 persistence adapter over the frozen Phase 1 Prisma repositories. */
export class PrismaReasoningRepository implements ReasoningRepository {
  async appendTranscript(entry: TranscriptEntry): Promise<void> {
    await appendTranscriptEntry(entry)
  }

  async readTranscript(groupId: string, limit: number): Promise<TranscriptEntry[]> {
    return getTranscriptByGroup(groupId, limit)
  }

  async getGroupProfile(groupId: string): Promise<GroupProfile | undefined> {
    return (await getGroupProfile(groupId)) ?? undefined
  }

  async mergeGroupProfile(profile: GroupProfile): Promise<GroupProfile> {
    return upsertGroupProfile(profile.group_id, {
      shared_interests: profile.shared_interests,
      initiators: profile.initiators,
      followers: profile.followers,
      sentiment_notes: profile.sentiment_notes,
    })
  }

  async getPersonProfiles(groupId: string): Promise<PersonProfile[]> {
    return getPersonProfilesForGroup(groupId)
  }

  async mergePersonProfile(profile: PersonProfile): Promise<PersonProfile> {
    return upsertPersonProfile(profile.person_id, profile.group_id, profile.name, {
      interests: profile.interests,
      budget_signals: profile.budget_signals,
      constraints: profile.constraints,
      availability_mentions: profile.availability_mentions,
    })
  }

  async getCurrentPlan(groupId: string): Promise<PlanObject | undefined> {
    return (await getCurrentPlanForGroup(groupId)) ?? undefined
  }

  async saveNextPlan(groupId: string, plan: PlanObject): Promise<PlanObject> {
    return createPlanVersion(groupId, plan)
  }
}

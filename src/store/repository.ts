import type { GroupProfile, PersonProfile, PlanObject, TranscriptEntry } from '../types/index.js';

export interface ReasoningRepository {
  appendTranscript(entry: TranscriptEntry): Promise<void>;
  readTranscript(groupId: string, limit: number): Promise<TranscriptEntry[]>;
  getGroupProfile(groupId: string): Promise<GroupProfile | undefined>;
  mergeGroupProfile(profile: GroupProfile): Promise<GroupProfile>;
  getPersonProfiles(groupId: string): Promise<PersonProfile[]>;
  mergePersonProfile(profile: PersonProfile): Promise<PersonProfile>;
  getCurrentPlan(groupId: string): Promise<PlanObject | undefined>;
  saveNextPlan(groupId: string, plan: PlanObject): Promise<PlanObject>;
}

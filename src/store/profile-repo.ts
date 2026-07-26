import { prisma } from './client.js'
import {
  PersonProfileSchema,
  GroupProfileSchema,
  type PersonProfile,
  type GroupProfile,
  type ActivityMention,
} from '../types/profile.js'

// Confidence formula per design-doc §6: single mention is weaker than three.
// ponytail: linear scaling, revisit if confidence values need non-linear weighting
function computeConfidence(mentionCount: number): number {
  return Math.min(0.9, 0.3 * mentionCount)
}

function parsePersonRow(row: {
  personId: string
  groupId: string
  name: string
  interests: string
  budgetSignals: string
  constraints: string
  availabilityMentions: string
  updatedAt: Date
}): PersonProfile {
  return PersonProfileSchema.parse({
    person_id: row.personId,
    group_id: row.groupId,
    name: row.name,
    interests: JSON.parse(row.interests) as unknown,
    budget_signals: JSON.parse(row.budgetSignals) as unknown,
    constraints: JSON.parse(row.constraints) as unknown,
    availability_mentions: JSON.parse(row.availabilityMentions) as unknown,
    updated_at: row.updatedAt.getTime(),
  })
}

function parseGroupRow(row: {
  groupId: string
  sharedInterests: string
  initiators: string
  followers: string
  sentimentNotes: string
  updatedAt: Date
}): GroupProfile {
  return GroupProfileSchema.parse({
    group_id: row.groupId,
    shared_interests: JSON.parse(row.sharedInterests) as unknown,
    initiators: JSON.parse(row.initiators) as unknown,
    followers: JSON.parse(row.followers) as unknown,
    sentiment_notes: JSON.parse(row.sentimentNotes) as unknown,
    updated_at: row.updatedAt.getTime(),
  })
}

// Merge incoming interests into the existing list.
// Repeated mentions of the same activity increment mention_count and raise confidence.
function mergeInterests(
  existing: ActivityMention[],
  incoming: ActivityMention[],
): ActivityMention[] {
  const map = new Map<string, ActivityMention>()
  for (const m of existing) map.set(m.activity, m)

  for (const inc of incoming) {
    const prev = map.get(inc.activity)
    if (prev) {
      const newCount = prev.mention_count + inc.mention_count
      map.set(inc.activity, {
        activity: inc.activity,
        recency: Math.max(prev.recency, inc.recency),
        mention_count: newCount,
        confidence: computeConfidence(newCount),
      })
    } else {
      map.set(inc.activity, {
        ...inc,
        confidence: computeConfidence(inc.mention_count),
      })
    }
  }
  return Array.from(map.values())
}

export async function upsertPersonProfile(
  personId: string,
  groupId: string,
  name: string,
  updates: Partial<
    Pick<PersonProfile, 'interests' | 'budget_signals' | 'constraints' | 'availability_mentions'>
  >,
): Promise<PersonProfile> {
  const existing = await prisma.personProfile.findUnique({
    where: { personId_groupId: { personId, groupId } },
  })

  const prev = existing ? parsePersonRow(existing) : null

  const mergedInterests = mergeInterests(prev?.interests ?? [], updates.interests ?? [])
  const mergedBudget = Array.from(
    new Set([...(prev?.budget_signals ?? []), ...(updates.budget_signals ?? [])]),
  )
  const mergedConstraints = Array.from(
    new Set([...(prev?.constraints ?? []), ...(updates.constraints ?? [])]),
  )
  const mergedAvailability = [
    ...(prev?.availability_mentions ?? []),
    ...(updates.availability_mentions ?? []),
  ]

  const row = await prisma.personProfile.upsert({
    where: { personId_groupId: { personId, groupId } },
    create: {
      personId,
      groupId,
      name,
      interests: JSON.stringify(mergedInterests),
      budgetSignals: JSON.stringify(mergedBudget),
      constraints: JSON.stringify(mergedConstraints),
      availabilityMentions: JSON.stringify(mergedAvailability),
    },
    update: {
      name,
      interests: JSON.stringify(mergedInterests),
      budgetSignals: JSON.stringify(mergedBudget),
      constraints: JSON.stringify(mergedConstraints),
      availabilityMentions: JSON.stringify(mergedAvailability),
    },
  })
  return parsePersonRow(row)
}

export async function getPersonProfile(
  personId: string,
  groupId: string,
): Promise<PersonProfile | null> {
  const row = await prisma.personProfile.findUnique({
    where: { personId_groupId: { personId, groupId } },
  })
  if (!row) return null
  return parsePersonRow(row)
}

export async function getPersonProfilesForGroup(groupId: string): Promise<PersonProfile[]> {
  const rows = await prisma.personProfile.findMany({ where: { groupId }, orderBy: { personId: 'asc' } })
  return rows.map((row) => parsePersonRow(row))
}

export async function upsertGroupProfile(
  groupId: string,
  updates: Partial<
    Pick<GroupProfile, 'shared_interests' | 'initiators' | 'followers' | 'sentiment_notes'>
  >,
): Promise<GroupProfile> {
  const existing = await prisma.groupProfile.findUnique({ where: { groupId } })
  const prev = existing ? parseGroupRow(existing) : null

  const merged = {
    shared_interests: Array.from(
      new Set([...(prev?.shared_interests ?? []), ...(updates.shared_interests ?? [])]),
    ),
    initiators: Array.from(new Set([...(prev?.initiators ?? []), ...(updates.initiators ?? [])])),
    followers: Array.from(new Set([...(prev?.followers ?? []), ...(updates.followers ?? [])])),
    sentiment_notes: [...(prev?.sentiment_notes ?? []), ...(updates.sentiment_notes ?? [])],
  }

  const row = await prisma.groupProfile.upsert({
    where: { groupId },
    create: {
      groupId,
      sharedInterests: JSON.stringify(merged.shared_interests),
      initiators: JSON.stringify(merged.initiators),
      followers: JSON.stringify(merged.followers),
      sentimentNotes: JSON.stringify(merged.sentiment_notes),
    },
    update: {
      sharedInterests: JSON.stringify(merged.shared_interests),
      initiators: JSON.stringify(merged.initiators),
      followers: JSON.stringify(merged.followers),
      sentimentNotes: JSON.stringify(merged.sentiment_notes),
    },
  })
  return parseGroupRow(row)
}

export async function getGroupProfile(groupId: string): Promise<GroupProfile | null> {
  const row = await prisma.groupProfile.findUnique({ where: { groupId } })
  if (!row) return null
  return parseGroupRow(row)
}

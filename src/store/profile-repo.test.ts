import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from './client.js'
import {
  upsertPersonProfile,
  getPersonProfile,
  upsertGroupProfile,
  getGroupProfile,
} from './profile-repo.js'

const GROUP = 'test-group-profile'

beforeEach(async () => {
  await prisma.personProfile.deleteMany({ where: { groupId: GROUP } })
  await prisma.groupProfile.deleteMany({ where: { groupId: GROUP } })
})

afterAll(async () => {
  await prisma.personProfile.deleteMany({ where: { groupId: GROUP } })
  await prisma.groupProfile.deleteMany({ where: { groupId: GROUP } })
  await prisma.$disconnect()
})

describe('upsertPersonProfile — interest confidence/recency', () => {
  it('stores a new person profile with initial confidence 0.3 for one mention', async () => {
    const profile = await upsertPersonProfile('person-a', GROUP, 'Sam', {
      interests: [{ activity: 'climbing', recency: 1_000_000, confidence: 0.3, mention_count: 1 }],
    })
    expect(profile.interests.find((i) => i.activity === 'climbing')?.mention_count).toBe(1)
    expect(profile.interests.find((i) => i.activity === 'climbing')?.confidence).toBeCloseTo(0.3)
  })

  it('repeated mention raises confidence above a single mention', async () => {
    // First mention
    await upsertPersonProfile('person-b', GROUP, 'Sam', {
      interests: [{ activity: 'bowling', recency: 1_000_000, confidence: 0.3, mention_count: 1 }],
    })
    // Second mention of same activity
    await upsertPersonProfile('person-b', GROUP, 'Sam', {
      interests: [{ activity: 'bowling', recency: 2_000_000, confidence: 0.3, mention_count: 1 }],
    })

    const profile = await getPersonProfile('person-b', GROUP)
    const bowling = profile?.interests.find((i) => i.activity === 'bowling')

    expect(bowling?.mention_count).toBe(2)
    // confidence after 2 mentions (0.6) must exceed confidence after 1 mention (0.3)
    expect(bowling?.confidence).toBeGreaterThan(0.3)
    expect(bowling?.confidence).toBeCloseTo(0.6)
  })

  it('three mentions produce higher confidence than two', async () => {
    const pid = 'person-c'
    for (let i = 1; i <= 3; i++) {
      await upsertPersonProfile(pid, GROUP, 'Jess', {
        interests: [
          { activity: 'jazz', recency: i * 1_000_000, confidence: 0.3, mention_count: 1 },
        ],
      })
    }
    const profile = await getPersonProfile(pid, GROUP)
    const jazz = profile?.interests.find((i) => i.activity === 'jazz')
    expect(jazz?.mention_count).toBe(3)
    expect(jazz?.confidence).toBeGreaterThanOrEqual(0.6)
  })

  it('updates recency to the most recent mention timestamp', async () => {
    await upsertPersonProfile('person-d', GROUP, 'Alex', {
      interests: [{ activity: 'hiking', recency: 1_000, confidence: 0.3, mention_count: 1 }],
    })
    await upsertPersonProfile('person-d', GROUP, 'Alex', {
      interests: [{ activity: 'hiking', recency: 9_999, confidence: 0.3, mention_count: 1 }],
    })
    const profile = await getPersonProfile('person-d', GROUP)
    expect(profile?.interests.find((i) => i.activity === 'hiking')?.recency).toBe(9_999)
  })

  it('merges budget signals without duplicates', async () => {
    await upsertPersonProfile('person-e', GROUP, 'Sam', { budget_signals: ['tight this month'] })
    await upsertPersonProfile('person-e', GROUP, 'Sam', {
      budget_signals: ['tight this month', 'splurge ok'],
    })
    const profile = await getPersonProfile('person-e', GROUP)
    expect(profile?.budget_signals).toContain('tight this month')
    expect(profile?.budget_signals).toContain('splurge ok')
    // deduplication: 'tight this month' should appear only once
    expect(profile?.budget_signals.filter((s) => s === 'tight this month')).toHaveLength(1)
  })

  it('returns null for a person that does not exist', async () => {
    const result = await getPersonProfile('no-such-person', GROUP)
    expect(result).toBeNull()
  })
})

describe('upsertGroupProfile', () => {
  it('accumulates shared interests across upserts', async () => {
    await upsertGroupProfile(GROUP, { shared_interests: ['climbing'] })
    await upsertGroupProfile(GROUP, { shared_interests: ['bowling'] })
    const group = await getGroupProfile(GROUP)
    expect(group?.shared_interests).toContain('climbing')
    expect(group?.shared_interests).toContain('bowling')
  })

  it('returns null for a group that does not exist', async () => {
    const result = await getGroupProfile('no-such-group')
    expect(result).toBeNull()
  })
})

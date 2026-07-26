import { describe, expect, it } from 'vitest'
import { GroupProfileSchema, PersonProfileSchema } from './profile.js'

const validPerson = {
  person_id: 'sam',
  group_id: 'weekend-friends',
  name: 'Sam',
  interests: [
    { activity: 'climbing', recency: 1_725_000_000_000, confidence: 0.6, mention_count: 2 },
  ],
  budget_signals: ['keeping costs down'],
  constraints: ['vegetarian'],
  availability_mentions: ['free Saturday evening'],
  updated_at: 1_725_000_000_000,
}

describe('PersonProfileSchema', () => {
  it('parses a concrete profile with extracted preference signals', () => {
    const result = PersonProfileSchema.safeParse(validPerson)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.interests[0]).toEqual({
        activity: 'climbing',
        recency: 1_725_000_000_000,
        confidence: 0.6,
        mention_count: 2,
      })
    }
  })

  it('rejects an interest whose confidence is outside the allowed range', () => {
    const result = PersonProfileSchema.safeParse({
      ...validPerson,
      interests: [{ ...validPerson.interests[0], confidence: 1.1 }],
    })

    expect(result.success).toBe(false)
  })

  it('rejects a zero mention count', () => {
    const result = PersonProfileSchema.safeParse({
      ...validPerson,
      interests: [{ ...validPerson.interests[0], mention_count: 0 }],
    })

    expect(result.success).toBe(false)
  })
})

describe('GroupProfileSchema', () => {
  it('parses group-level planning signals', () => {
    const result = GroupProfileSchema.safeParse({
      group_id: 'weekend-friends',
      shared_interests: ['climbing', 'bowling'],
      initiators: ['sam'],
      followers: ['jess'],
      sentiment_notes: ['budget-sensitive this month'],
      updated_at: 1_725_000_000_000,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.initiators).toEqual(['sam'])
      expect(result.data.shared_interests).toEqual(['climbing', 'bowling'])
    }
  })

  it('rejects a negative update timestamp', () => {
    const result = GroupProfileSchema.safeParse({
      group_id: 'weekend-friends',
      shared_interests: [],
      initiators: [],
      followers: [],
      sentiment_notes: [],
      updated_at: -1,
    })

    expect(result.success).toBe(false)
  })
})

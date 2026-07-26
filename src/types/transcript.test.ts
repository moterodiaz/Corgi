import { describe, expect, it } from 'vitest'
import { TranscriptEntrySchema } from './transcript.js'

describe('TranscriptEntrySchema', () => {
  it('parses a concrete ISO-8601 group-chat entry', () => {
    const result = TranscriptEntrySchema.safeParse({
      groupId: 'weekend-friends',
      sender: 'sam',
      text: 'How about bowling on Saturday?',
      timestamp: '2026-08-01T18:00:00-07:00',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.text).toBe('How about bowling on Saturday?')
      expect(result.data.groupId).toBe('weekend-friends')
    }
  })

  it('rejects a timestamp without an explicit timezone offset', () => {
    const result = TranscriptEntrySchema.safeParse({
      groupId: 'weekend-friends',
      sender: 'sam',
      text: 'How about bowling on Saturday?',
      timestamp: '2026-08-01T18:00:00',
    })

    expect(result.success).toBe(false)
  })
})

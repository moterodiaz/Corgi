import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from './client.js'
import { appendTranscriptEntry, getTranscriptByGroup } from './transcript-repo.js'
import type { TranscriptEntry } from '../types/transcript.js'

const GROUP_A = 'test-group-transcript-a'
const GROUP_B = 'test-group-transcript-b'

function makeEntry({
  groupId,
  ...rest
}: Partial<TranscriptEntry> & { groupId: string }): TranscriptEntry {
  return {
    sender: 'sam',
    text: 'hey',
    timestamp: '2026-08-01T10:00:00Z',
    groupId,
    ...rest,
  }
}

beforeEach(async () => {
  await prisma.transcriptBuffer.deleteMany({ where: { groupId: { in: [GROUP_A, GROUP_B] } } })
})

afterAll(async () => {
  await prisma.transcriptBuffer.deleteMany({ where: { groupId: { in: [GROUP_A, GROUP_B] } } })
  await prisma.$disconnect()
})

describe('appendTranscriptEntry + getTranscriptByGroup', () => {
  it('appends an entry and reads it back with exact field values', async () => {
    await appendTranscriptEntry(
      makeEntry({
        groupId: GROUP_A,
        sender: 'sam',
        text: 'we should hang out',
        timestamp: '2026-08-01T10:00:00Z',
      }),
    )
    const entries = await getTranscriptByGroup(GROUP_A)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.sender).toBe('sam')
    expect(entries[0]?.text).toBe('we should hang out')
    expect(entries[0]?.groupId).toBe(GROUP_A)
  })

  it('returns entries in ascending timestamp order', async () => {
    await appendTranscriptEntry(
      makeEntry({
        groupId: GROUP_A,
        sender: 'jess',
        timestamp: '2026-08-01T10:02:00Z',
        text: 'third',
      }),
    )
    await appendTranscriptEntry(
      makeEntry({
        groupId: GROUP_A,
        sender: 'sam',
        timestamp: '2026-08-01T10:00:00Z',
        text: 'first',
      }),
    )
    await appendTranscriptEntry(
      makeEntry({
        groupId: GROUP_A,
        sender: 'alex',
        timestamp: '2026-08-01T10:01:00Z',
        text: 'second',
      }),
    )

    const entries = await getTranscriptByGroup(GROUP_A)
    expect(entries[0]?.text).toBe('first')
    expect(entries[1]?.text).toBe('second')
    expect(entries[2]?.text).toBe('third')
  })

  it('scopes reads to the requested groupId — group B entries do not appear in group A results', async () => {
    await appendTranscriptEntry(
      makeEntry({ groupId: GROUP_A, sender: 'sam', text: 'group a message' }),
    )
    await appendTranscriptEntry(
      makeEntry({ groupId: GROUP_B, sender: 'alex', text: 'group b message' }),
    )

    const entriesA = await getTranscriptByGroup(GROUP_A)
    const entriesB = await getTranscriptByGroup(GROUP_B)

    expect(entriesA).toHaveLength(1)
    expect(entriesA[0]?.text).toBe('group a message')
    expect(entriesB).toHaveLength(1)
    expect(entriesB[0]?.text).toBe('group b message')
  })

  it('returns empty array for a group with no transcript', async () => {
    const entries = await getTranscriptByGroup('no-such-group')
    expect(entries).toEqual([])
  })

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await appendTranscriptEntry(
        makeEntry({ groupId: GROUP_A, text: `msg-${i}`, timestamp: `2026-08-01T10:0${i}:00Z` }),
      )
    }
    const limited = await getTranscriptByGroup(GROUP_A, 3)
    expect(limited).toHaveLength(3)
  })
})

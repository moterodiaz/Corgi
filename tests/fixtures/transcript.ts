// DEMO FIXTURE — not production data. Per AGENTS.md §7, kept in tests/fixtures/ only.
// Loosely follows design-doc.md §11 demo narrative: friend chatter → budget mention →
// wanting to try something new → explicit "we should hang out" trigger.
import { TranscriptEntrySchema, type TranscriptEntry } from '../../src/types/transcript.js'
import { z } from 'zod'

export const FIXTURE_GROUP_ID = 'demo-group-001'

const rawEntries = [
  {
    sender: 'sam',
    text: 'hey what did everyone do this weekend?',
    timestamp: '2026-08-01T09:00:00Z',
  },
  {
    sender: 'jess',
    text: 'just hung around, honestly broke this month lol',
    timestamp: '2026-08-01T09:01:00Z',
  },
  {
    sender: 'alex',
    text: 'same, been wanting to try something active though',
    timestamp: '2026-08-01T09:02:00Z',
  },
  {
    sender: 'sam',
    text: "yes!! I've been curious about that climbing gym near downtown",
    timestamp: '2026-08-01T09:03:00Z',
  },
  {
    sender: 'jess',
    text: 'climbing sounds fun but yeah budget is tight rn',
    timestamp: '2026-08-01T09:04:00Z',
  },
  {
    sender: 'alex',
    text: 'I think they have a cheap intro session or something',
    timestamp: '2026-08-01T09:05:00Z',
  },
  {
    sender: 'sam',
    text: "we should really hang out soon, it's been forever",
    timestamp: '2026-08-01T09:10:00Z',
  },
]

// Validate fixtures against the shared Zod schema at import time — catches schema drift early.
export const fixtureTranscript: TranscriptEntry[] = z
  .array(TranscriptEntrySchema)
  .parse(rawEntries.map((e) => ({ ...e, groupId: FIXTURE_GROUP_ID })))

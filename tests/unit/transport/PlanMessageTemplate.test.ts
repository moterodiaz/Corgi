import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  renderPlanMessageText,
  type PlanObject,
  type PlanStatus,
  type RsvpState,
} from '../../../src/transport/PlanMessageTemplate.js'

// formatDateTime() inside the module under test calls Date#toLocaleString with
// no explicit timeZone option, so it renders in whatever zone the process is
// running in. Pin TZ for this file so the "exact string" assertions below are
// deterministic on every machine/CI runner, then restore it afterward since
// vitest.config.ts runs test files in a single shared worker process.
const ORIGINAL_TZ = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles'
})

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
})

function makePlan(overrides: Partial<PlanObject> = {}): PlanObject {
  return {
    planId: 'plan-1',
    version: 1,
    status: 'proposed',
    activity: 'trivia night',
    venue: {
      name: 'The Old Pro',
      sourceTool: 'yelp',
      refId: 'venue-123',
    },
    datetime: '2026-08-01T19:00:00-07:00',
    costTier: 'low',
    attendees: {
      Amy: 'yes',
      Ben: 'no',
    },
    rationale: 'Everyone is free Friday night and it fits the budget.',
    ...overrides,
  }
}

describe('renderPlanMessageText', () => {
  it('renders the exact message for a representative version-1 plan', () => {
    const rendered = renderPlanMessageText(makePlan())

    expect(rendered).toBe(
      [
        '📍 New plan',
        '',
        'Trivia night at The Old Pro',
        'Sat, Aug 1, 7:00 PM',
        '💰 low cost',
        '',
        'Everyone is free Friday night and it fits the budget.',
        '',
        'Proposed',
        '✅ Amy',
        '❌ Ben',
      ].join('\n'),
    )
  })

  describe('header', () => {
    it('renders the "New plan" header with the pin emoji for version 1', () => {
      const rendered = renderPlanMessageText(makePlan({ version: 1 }))

      expect(rendered.split('\n')[0]).toBe('📍 New plan')
    })

    for (const version of [2, 3, 10]) {
      it(`renders "Updated plan (v${version})" with the cycle emoji for version ${version}`, () => {
        const rendered = renderPlanMessageText(makePlan({ version }))

        expect(rendered.split('\n')[0]).toBe(`🔄 Updated plan (v${version})`)
      })
    }
  })

  describe('status labels', () => {
    const cases: ReadonlyArray<{ status: PlanStatus; label: string }> = [
      { status: 'proposed', label: 'Proposed' },
      { status: 'revising', label: 'Revising' },
      { status: 'confirmed', label: '✅ Confirmed' },
      { status: 'abandoned', label: 'Abandoned' },
    ]

    for (const { status, label } of cases) {
      it(`renders "${label}" for status "${status}"`, () => {
        const rendered = renderPlanMessageText(makePlan({ status }))
        const lines = rendered.split('\n')

        // Index 8 is stable regardless of status/attendees: header, blank,
        // activity, datetime, cost, blank, rationale, blank, status.
        expect(lines[8]).toBe(label)
      })
    }

    it('includes the checkmark specifically for confirmed', () => {
      const rendered = renderPlanMessageText(makePlan({ status: 'confirmed' }))

      expect(rendered).toContain('✅ Confirmed')
    })
  })

  describe('RSVP emoji and sort order', () => {
    const cases: ReadonlyArray<{ state: RsvpState; emoji: string }> = [
      { state: 'yes', emoji: '✅' },
      { state: 'no', emoji: '❌' },
      { state: 'pending', emoji: '⏳' },
    ]

    for (const { state, emoji } of cases) {
      it(`renders "${emoji}" for RSVP state "${state}"`, () => {
        const rendered = renderPlanMessageText(makePlan({ attendees: { Casey: state } }))
        const lines = rendered.split('\n')

        // Index 9 is the first (and only) RSVP line here.
        expect(lines[9]).toBe(`${emoji} Casey`)
      })
    }

    it('sorts attendees alphabetically by name regardless of input order', () => {
      const plan = makePlan({
        attendees: {
          Zoe: 'yes',
          Amy: 'no',
          Mike: 'pending',
        },
      })

      const rendered = renderPlanMessageText(plan)
      const lines = rendered.split('\n')

      expect(lines.slice(-3)).toEqual(['❌ Amy', '⏳ Mike', '✅ Zoe'])
    })
  })

  describe('datetime formatting', () => {
    it('renders an unparseable datetime string as-is instead of throwing or showing Invalid Date', () => {
      const rendered = renderPlanMessageText(makePlan({ datetime: 'not-a-real-date' }))
      const lines = rendered.split('\n')

      expect(lines[3]).toBe('not-a-real-date')
      expect(rendered).not.toContain('Invalid Date')
    })

    it('does not throw for an unparseable datetime string', () => {
      expect(() => renderPlanMessageText(makePlan({ datetime: 'banana' }))).not.toThrow()
    })

    it('renders a valid datetime using the documented weekday/month/day/time format', () => {
      const rendered = renderPlanMessageText(makePlan({ datetime: '2026-08-01T19:00:00-07:00' }))
      const lines = rendered.split('\n')

      expect(lines[3]).toBe('Sat, Aug 1, 7:00 PM')
    })
  })

  describe('cost tier labels', () => {
    const cases: ReadonlyArray<{ costTier: PlanObject['costTier']; line: string }> = [
      { costTier: 'low', line: '💰 low cost' },
      { costTier: 'medium', line: '💰 medium cost' },
      { costTier: 'high', line: '💰 higher cost' },
    ]

    for (const { costTier, line } of cases) {
      it(`renders "${line}" for cost tier "${costTier}"`, () => {
        const rendered = renderPlanMessageText(makePlan({ costTier }))
        const lines = rendered.split('\n')

        expect(lines[4]).toBe(line)
      })
    }
  })

  describe('venue and activity', () => {
    it('renders the title-cased activity and the venue name on one line', () => {
      const plan = makePlan({
        activity: 'bowling night',
        venue: { name: 'Bowlmor Lanes', sourceTool: 'yelp', refId: 'v-9' },
      })

      const rendered = renderPlanMessageText(plan)
      const lines = rendered.split('\n')

      expect(lines[2]).toBe('Bowling night at Bowlmor Lanes')
    })

    it('only capitalizes the first character of the activity, not each word', () => {
      const plan = makePlan({ activity: 'mini golf' })

      const rendered = renderPlanMessageText(plan)
      const lines = rendered.split('\n')

      expect(lines[2]).toBe('Mini golf at The Old Pro')
    })
  })

  describe('rationale', () => {
    it('renders the rationale verbatim, including embedded newlines and emoji', () => {
      const rationale = 'Great weather forecast 🌞\nEveryone already said yes.'
      const rendered = renderPlanMessageText(makePlan({ rationale }))

      // Bounding blank lines on both sides confirm the rationale is inserted
      // as one contiguous, unmodified block rather than escaped or mangled.
      expect(rendered).toContain(`\n\n${rationale}\n\n`)
      expect(rendered).not.toContain('\\n')
    })

    it('renders a plain single-line rationale verbatim', () => {
      const rationale = 'Everyone is free Friday night and it fits the budget.'
      const rendered = renderPlanMessageText(makePlan({ rationale }))
      const lines = rendered.split('\n')

      expect(lines[6]).toBe(rationale)
    })
  })

  describe('attendees', () => {
    it('renders no RSVP lines and no stray trailing content for an empty attendees object', () => {
      const rendered = renderPlanMessageText(makePlan({ attendees: {} }))
      const lines = rendered.split('\n')

      expect(lines).toHaveLength(9)
      expect(lines[8]).toBe('Proposed')
      expect(rendered.endsWith('\n')).toBe(false)
    })

    it('does not throw for an empty attendees object', () => {
      expect(() => renderPlanMessageText(makePlan({ attendees: {} }))).not.toThrow()
    })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CalendarQueryError,
  createGroupAvailabilityCoordinator,
  GroupAvailabilityAuthorizationError,
  type AuthorizedGroupSnapshot,
  type GroupAvailabilityDependencies,
  type GroupMemberRecord,
} from '../../../src/tools/group-availability.js'

const CANDIDATE_INTERVAL = {
  start: '2026-08-02T14:00:00-07:00',
  end: '2026-08-02T16:00:00-07:00',
} as const

const GROUP_A_MEMBERS = [
  {
    group_member_id: 'group-a-sam',
    group_id: 'group-a',
    person_id: 'sam',
    active: true,
  },
  {
    group_member_id: 'group-a-jess',
    group_id: 'group-a',
    person_id: 'jess',
    active: true,
  },
] satisfies GroupMemberRecord[]

const GROUP_B_MEMBERS = [
  {
    group_member_id: 'group-b-sam',
    group_id: 'group-b',
    person_id: 'sam',
    active: true,
  },
] satisfies GroupMemberRecord[]

const GROUP_A_SNAPSHOT = {
  group_id: 'group-a',
  membership_revision: 7,
  active_members: GROUP_A_MEMBERS,
} satisfies AuthorizedGroupSnapshot

const GROUP_B_SNAPSHOT = {
  group_id: 'group-b',
  membership_revision: 11,
  active_members: GROUP_B_MEMBERS,
} satisfies AuthorizedGroupSnapshot

function request(groupId = 'group-a') {
  return {
    group_id: groupId,
    candidate_interval: CANDIDATE_INTERVAL,
  }
}

function snapshotForGroup(groupId: string): AuthorizedGroupSnapshot {
  return groupId === 'group-b' ? GROUP_B_SNAPSHOT : GROUP_A_SNAPSHOT
}

function member(index: number, overrides: Partial<GroupMemberRecord> = {}): GroupMemberRecord {
  return {
    group_member_id: `group-a-member-${String(index)}`,
    group_id: 'group-a',
    person_id: `person-${String(index)}`,
    active: true,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

function dependencyHarness(overrides: Partial<GroupAvailabilityDependencies> = {}) {
  const resolveAuthorizedGroupSnapshot = vi.fn<
    GroupAvailabilityDependencies['resolveAuthorizedGroupSnapshot']
  >(
    overrides.resolveAuthorizedGroupSnapshot ??
      ((groupId) => Promise.resolve(snapshotForGroup(groupId))),
  )
  const resolveGlobalToolIdentity = vi.fn<
    GroupAvailabilityDependencies['resolveGlobalToolIdentity']
  >(
    overrides.resolveGlobalToolIdentity ??
      ((query) =>
        Promise.resolve({
          merge_registered_user_id: `merge-${query.person_id}`,
        })),
  )
  const queryCalendarAvailability = vi.fn<
    GroupAvailabilityDependencies['queryCalendarAvailability']
  >(overrides.queryCalendarAvailability ?? (() => Promise.resolve({ availability: 'free' })))
  const inferChatAvailability = vi.fn<GroupAvailabilityDependencies['inferChatAvailability']>(
    overrides.inferChatAvailability ?? (() => Promise.resolve({ availability: 'pending' })),
  )
  const dependencies: GroupAvailabilityDependencies = {
    inferChatAvailability,
    queryCalendarAvailability,
    resolveAuthorizedGroupSnapshot,
    resolveGlobalToolIdentity,
  }

  return {
    dependencies,
    inferChatAvailability,
    queryCalendarAvailability,
    resolveAuthorizedGroupSnapshot,
    resolveGlobalToolIdentity,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('authoritative group snapshots', () => {
  it('uses every member in the snapshot without a caller-controlled omission list', async () => {
    const harness = dependencyHarness()
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    await expect(coordinate(request())).resolves.toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'free',
          source: 'calendar',
        },
        {
          group_member_id: 'group-a-jess',
          availability: 'free',
          source: 'calendar',
        },
      ],
    })
    expect(harness.resolveAuthorizedGroupSnapshot).toHaveBeenCalledOnce()
    expect(harness.resolveAuthorizedGroupSnapshot).toHaveBeenCalledWith(
      'group-a',
      expect.any(AbortSignal),
    )
    expect(harness.resolveGlobalToolIdentity).toHaveBeenCalledTimes(2)
    expect(harness.resolveGlobalToolIdentity).toHaveBeenCalledWith(
      {
        group_id: 'group-a',
        group_member_id: 'group-a-sam',
        person_id: 'sam',
        membership_revision: 7,
      },
      expect.any(AbortSignal),
    )
    expect(harness.resolveGlobalToolIdentity).toHaveBeenCalledWith(
      {
        group_id: 'group-a',
        group_member_id: 'group-a-jess',
        person_id: 'jess',
        membership_revision: 7,
      },
      expect.any(AbortSignal),
    )
    expect(harness.queryCalendarAvailability).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      name: 'a snapshot for a different group',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        group_id: 'group-b',
        active_members: GROUP_B_MEMBERS,
      },
    },
    {
      name: 'a cross-group member',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        active_members: [
          member(1, {
            group_id: 'group-b',
          }),
        ],
      },
    },
    {
      name: 'an inactive member',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        active_members: [member(1, { active: false })],
      },
    },
    {
      name: 'a malformed member',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        active_members: [
          {
            ...member(1),
            unexpected_private_field: 'must not be accepted',
          },
        ],
      },
    },
    {
      name: 'a duplicate person',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        active_members: [
          member(1, { person_id: 'same-person' }),
          member(2, { person_id: 'same-person' }),
        ],
      },
    },
    {
      name: 'a duplicate member',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        active_members: [
          member(1, { group_member_id: 'same-member' }),
          member(2, { group_member_id: 'same-member' }),
        ],
      },
    },
    {
      name: 'an empty member list',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        active_members: [],
      },
    },
    {
      name: 'more than 50 members',
      rawSnapshot: {
        ...GROUP_A_SNAPSHOT,
        active_members: Array.from({ length: 51 }, (_, index) => member(index)),
      },
    },
  ])(
    'rejects $name with one sanitized authorization code before personal-data calls',
    async ({ rawSnapshot }) => {
      const harness = dependencyHarness({
        resolveAuthorizedGroupSnapshot: () => Promise.resolve(rawSnapshot),
      })
      const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

      await expect(coordinate(request())).rejects.toMatchObject({
        name: 'GroupAvailabilityAuthorizationError',
        message: 'Group availability authorization failed',
        code: 'authorization_snapshot_failed',
      })
      expect(harness.resolveAuthorizedGroupSnapshot).toHaveBeenCalledOnce()
      expect(harness.resolveGlobalToolIdentity).not.toHaveBeenCalled()
      expect(harness.queryCalendarAvailability).not.toHaveBeenCalled()
      expect(harness.inferChatAvailability).not.toHaveBeenCalled()
    },
  )

  it('does not start identity, calendar, or chat calls before the snapshot resolves', async () => {
    const snapshot = deferred<unknown>()
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: () => snapshot.promise,
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    const operation = coordinate(request())
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.resolveAuthorizedGroupSnapshot).toHaveBeenCalledOnce()
    expect(harness.resolveGlobalToolIdentity).not.toHaveBeenCalled()
    expect(harness.queryCalendarAvailability).not.toHaveBeenCalled()
    expect(harness.inferChatAvailability).not.toHaveBeenCalled()

    snapshot.resolve(GROUP_A_SNAPSHOT)
    await expect(operation).resolves.toMatchObject({
      group_id: 'group-a',
      membership_revision: 7,
    })
    expect(harness.resolveGlobalToolIdentity).toHaveBeenCalledTimes(2)
    expect(harness.queryCalendarAvailability).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      name: 'an unknown member-selection field',
      rawRequest: {
        ...request(),
        active_group_member_ids: ['group-a-sam'],
      },
    },
    {
      name: 'a reversed interval',
      rawRequest: {
        ...request(),
        candidate_interval: {
          start: '2026-08-02T16:00:00-07:00',
          end: '2026-08-02T14:00:00-07:00',
        },
      },
    },
    {
      name: 'a malformed interval timestamp',
      rawRequest: {
        ...request(),
        candidate_interval: {
          start: 'Sunday afternoon',
          end: '2026-08-02T16:00:00-07:00',
        },
      },
    },
  ])('strictly rejects $name before snapshot access', async ({ rawRequest }) => {
    const harness = dependencyHarness()
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    await expect(coordinate(rawRequest)).rejects.toMatchObject({
      name: 'ZodError',
    })
    expect(harness.resolveAuthorizedGroupSnapshot).not.toHaveBeenCalled()
    expect(harness.resolveGlobalToolIdentity).not.toHaveBeenCalled()
    expect(harness.queryCalendarAvailability).not.toHaveBeenCalled()
  })
})

describe('group-scoped calendar availability', () => {
  it('reuses one global identity across two group calls while isolating results', async () => {
    const globalMergeId = 'merge-global-sam'
    const groupAWithSamOnly = {
      ...GROUP_A_SNAPSHOT,
      active_members: [GROUP_A_MEMBERS[0]],
    }
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: (groupId) =>
        Promise.resolve(groupId === 'group-b' ? GROUP_B_SNAPSHOT : groupAWithSamOnly),
      resolveGlobalToolIdentity: () =>
        Promise.resolve({
          merge_registered_user_id: globalMergeId,
        }),
      queryCalendarAvailability: (query) =>
        Promise.resolve({
          availability: query.group_id === 'group-a' ? 'free' : 'busy',
        }),
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    const groupAResult = await coordinate(request('group-a'))
    const groupBResult = await coordinate(request('group-b'))

    expect(harness.resolveGlobalToolIdentity).toHaveBeenCalledTimes(2)
    expect(harness.queryCalendarAvailability).toHaveBeenCalledTimes(2)
    expect(harness.queryCalendarAvailability).toHaveBeenCalledWith(
      {
        group_id: 'group-a',
        group_member_id: 'group-a-sam',
        person_id: 'sam',
        membership_revision: 7,
        merge_registered_user_id: globalMergeId,
        candidate_interval: CANDIDATE_INTERVAL,
      },
      expect.any(AbortSignal),
    )
    expect(harness.queryCalendarAvailability).toHaveBeenCalledWith(
      {
        group_id: 'group-b',
        group_member_id: 'group-b-sam',
        person_id: 'sam',
        membership_revision: 11,
        merge_registered_user_id: globalMergeId,
        candidate_interval: CANDIDATE_INTERVAL,
      },
      expect.any(AbortSignal),
    )
    expect(groupAResult).toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'free',
          source: 'calendar',
        },
      ],
    })
    expect(groupBResult).toEqual({
      group_id: 'group-b',
      membership_revision: 11,
      members: [
        {
          group_member_id: 'group-b-sam',
          availability: 'busy',
          source: 'calendar',
        },
      ],
    })
    expect(JSON.stringify(groupAResult)).not.toContain('group-b')
    expect(JSON.stringify(groupBResult)).not.toContain('group-a')
  })

  it('returns normalized free and busy calendar evidence for every snapshot member', async () => {
    const harness = dependencyHarness({
      queryCalendarAvailability: (query) =>
        Promise.resolve({
          availability: query.group_member_id === 'group-a-sam' ? 'free' : 'busy',
        }),
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    await expect(coordinate(request())).resolves.toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'free',
          source: 'calendar',
        },
        {
          group_member_id: 'group-a-jess',
          availability: 'busy',
          source: 'calendar',
        },
      ],
    })
    expect(harness.inferChatAvailability).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'a missing identity',
      resolveIdentity: () => Promise.resolve(null),
      expectedWarning: undefined,
    },
    {
      name: 'a malformed identity',
      resolveIdentity: () =>
        Promise.resolve({
          merge_registered_user_id: 'merge-sam',
          private_extra: true,
        }),
      expectedWarning: 'upstream_error',
    },
    {
      name: 'a rejected identity lookup',
      resolveIdentity: () => Promise.reject(new Error('sensitive identity service details')),
      expectedWarning: 'upstream_error',
    },
    {
      name: 'a synchronously thrown identity lookup',
      resolveIdentity: () => {
        throw new Error('sensitive synchronous identity details')
      },
      expectedWarning: 'upstream_error',
    },
  ])(
    'uses same-group chat for $name without calling the calendar',
    async ({ resolveIdentity, expectedWarning }) => {
      const oneMemberSnapshot = {
        ...GROUP_A_SNAPSHOT,
        active_members: [GROUP_A_MEMBERS[0]],
      }
      const harness = dependencyHarness({
        resolveAuthorizedGroupSnapshot: () => Promise.resolve(oneMemberSnapshot),
        resolveGlobalToolIdentity: resolveIdentity,
        inferChatAvailability: () => Promise.resolve({ availability: 'free' }),
      })
      const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

      const result = await coordinate(request())

      expect(result).toEqual({
        group_id: 'group-a',
        membership_revision: 7,
        members: [
          {
            group_member_id: 'group-a-sam',
            availability: 'free',
            source: 'chat',
            ...(expectedWarning === undefined ? {} : { calendar_warning: expectedWarning }),
          },
        ],
      })
      expect(harness.queryCalendarAvailability).not.toHaveBeenCalled()
      expect(harness.inferChatAvailability).toHaveBeenCalledOnce()
      expect(harness.inferChatAvailability).toHaveBeenCalledWith(
        {
          group_id: 'group-a',
          group_member_id: 'group-a-sam',
          person_id: 'sam',
          membership_revision: 7,
          candidate_interval: CANDIDATE_INTERVAL,
        },
        expect.any(AbortSignal),
      )
    },
  )

  it('preserves reconnect-required as a warning with definitive chat evidence', async () => {
    const oneMemberSnapshot = {
      ...GROUP_A_SNAPSHOT,
      active_members: [GROUP_A_MEMBERS[0]],
    }
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: () => Promise.resolve(oneMemberSnapshot),
      queryCalendarAvailability: () =>
        Promise.resolve({
          availability: 'pending',
          pending_reason: 'reconnect_required',
        }),
      inferChatAvailability: () => Promise.resolve({ availability: 'busy' }),
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    await expect(coordinate(request())).resolves.toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'busy',
          source: 'chat',
          calendar_warning: 'reconnect_required',
        },
      ],
    })
  })

  it.each([
    {
      name: 'a malformed calendar response',
      calendarResult: () =>
        Promise.resolve({
          availability: 'sometimes',
        }),
    },
    {
      name: 'a rejected calendar query',
      calendarResult: () => Promise.reject(new CalendarQueryError('upstream_error')),
    },
    {
      name: 'a synchronously thrown calendar query',
      calendarResult: () => {
        throw new Error('sensitive synchronous calendar details')
      },
    },
  ])('uses chat and surfaces upstream_error for $name', async ({ calendarResult }) => {
    const oneMemberSnapshot = {
      ...GROUP_A_SNAPSHOT,
      active_members: [GROUP_A_MEMBERS[0]],
    }
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: () => Promise.resolve(oneMemberSnapshot),
      queryCalendarAvailability: calendarResult,
      inferChatAvailability: () => Promise.resolve({ availability: 'free' }),
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    await expect(coordinate(request())).resolves.toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'free',
          source: 'chat',
          calendar_warning: 'upstream_error',
        },
      ],
    })
    expect(harness.inferChatAvailability).toHaveBeenCalledOnce()
  })

  it('returns revision metadata without exposing Merge identity or raw calendar data', async () => {
    const secretMergeId = 'merge-secret-sam'
    const rawEventId = 'provider-event-123'
    const oneMemberSnapshot = {
      ...GROUP_A_SNAPSHOT,
      active_members: [GROUP_A_MEMBERS[0]],
    }
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: () => Promise.resolve(oneMemberSnapshot),
      resolveGlobalToolIdentity: () =>
        Promise.resolve({
          merge_registered_user_id: secretMergeId,
        }),
      queryCalendarAvailability: () =>
        Promise.resolve({
          availability: 'free',
          merge_registered_user_id: secretMergeId,
          raw_events: [{ id: rawEventId, summary: 'Private appointment' }],
        }),
      inferChatAvailability: () => Promise.resolve({ availability: 'free' }),
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies)

    const result = await coordinate(request())
    const serializedResult = JSON.stringify(result)

    expect(result).toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'free',
          source: 'chat',
          calendar_warning: 'upstream_error',
        },
      ],
    })
    expect(serializedResult).not.toContain(secretMergeId)
    expect(serializedResult).not.toContain(rawEventId)
    expect(serializedResult).not.toContain('raw_events')
  })
})

describe('operation deadlines', () => {
  it('does not launch chat fallback after a calendar consumes the total deadline', async () => {
    vi.useFakeTimers()
    let calendarSignal: AbortSignal | undefined
    const oneMemberSnapshot = {
      ...GROUP_A_SNAPSHOT,
      active_members: [GROUP_A_MEMBERS[0]],
    }
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: () => Promise.resolve(oneMemberSnapshot),
      queryCalendarAvailability: (_query, signal) => {
        calendarSignal = signal
        return new Promise<unknown>(() => undefined)
      },
      inferChatAvailability: () => Promise.resolve({ availability: 'free' }),
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies, { timeout_ms: 50 })

    const operation = coordinate(request())
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.queryCalendarAvailability).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(50)

    await expect(operation).resolves.toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'pending',
          source: 'none',
          pending_reason: 'timeout',
          calendar_warning: 'timeout',
        },
      ],
    })
    expect(calendarSignal?.aborted).toBe(true)
    expect(harness.inferChatAvailability).not.toHaveBeenCalled()
  })

  it('turns a never-resolving chat fallback into pending timeout evidence', async () => {
    vi.useFakeTimers()
    let chatSignal: AbortSignal | undefined
    const oneMemberSnapshot = {
      ...GROUP_A_SNAPSHOT,
      active_members: [GROUP_A_MEMBERS[0]],
    }
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: () => Promise.resolve(oneMemberSnapshot),
      resolveGlobalToolIdentity: () => Promise.resolve(null),
      inferChatAvailability: (_query, signal) => {
        chatSignal = signal
        return new Promise<unknown>(() => undefined)
      },
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies, { timeout_ms: 40 })

    const operation = coordinate(request())
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.inferChatAvailability).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(40)

    await expect(operation).resolves.toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'pending',
          source: 'none',
          pending_reason: 'timeout',
        },
      ],
    })
    expect(chatSignal?.aborted).toBe(true)
    expect(harness.queryCalendarAvailability).not.toHaveBeenCalled()
  })

  it('shares one total budget across delayed snapshot, identity, calendar, and chat stages', async () => {
    vi.useFakeTimers()
    let chatSignal: AbortSignal | undefined
    const oneMemberSnapshot = {
      ...GROUP_A_SNAPSHOT,
      active_members: [GROUP_A_MEMBERS[0]],
    }
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: () =>
        new Promise<unknown>((resolve) => {
          setTimeout(() => {
            resolve(oneMemberSnapshot)
          }, 30)
        }),
      resolveGlobalToolIdentity: () =>
        new Promise<unknown>((resolve) => {
          setTimeout(() => {
            resolve({ merge_registered_user_id: 'merge-sam' })
          }, 30)
        }),
      queryCalendarAvailability: () =>
        new Promise<unknown>((resolve) => {
          setTimeout(() => {
            resolve({
              availability: 'pending',
              pending_reason: 'reconnect_required',
            })
          }, 30)
        }),
      inferChatAvailability: (_query, signal) => {
        chatSignal = signal
        return new Promise<unknown>((resolve) => {
          setTimeout(() => {
            resolve({ availability: 'free' })
          }, 20)
        })
      },
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies, { timeout_ms: 100 })

    const operation = coordinate(request())
    let settled = false
    void operation.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(29)
    expect(harness.resolveGlobalToolIdentity).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(harness.resolveGlobalToolIdentity).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30)
    expect(harness.queryCalendarAvailability).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30)
    expect(harness.inferChatAvailability).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(9)
    expect(settled).toBe(false)
    expect(chatSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(operation).resolves.toEqual({
      group_id: 'group-a',
      membership_revision: 7,
      members: [
        {
          group_member_id: 'group-a-sam',
          availability: 'pending',
          source: 'none',
          pending_reason: 'timeout',
          calendar_warning: 'reconnect_required',
        },
      ],
    })
    expect(settled).toBe(true)
    expect(chatSignal?.aborted).toBe(true)
  })

  it('bounds the whole operation when the authorization snapshot never settles', async () => {
    vi.useFakeTimers()
    let snapshotSignal: AbortSignal | undefined
    const harness = dependencyHarness({
      resolveAuthorizedGroupSnapshot: (_groupId, signal) => {
        snapshotSignal = signal
        return new Promise<unknown>(() => undefined)
      },
    })
    const coordinate = createGroupAvailabilityCoordinator(harness.dependencies, { timeout_ms: 75 })

    const operation = coordinate(request())
    let settled = false
    void operation.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    const rejection = expect(operation).rejects.toEqual(new GroupAvailabilityAuthorizationError())
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(74)
    expect(settled).toBe(false)
    expect(snapshotSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(settled).toBe(true)
    expect(snapshotSignal?.aborted).toBe(true)
    expect(harness.resolveGlobalToolIdentity).not.toHaveBeenCalled()
    expect(harness.queryCalendarAvailability).not.toHaveBeenCalled()
    expect(harness.inferChatAvailability).not.toHaveBeenCalled()
  })
})

import { z } from 'zod'

export const DEFAULT_GROUP_AVAILABILITY_TIMEOUT_MS = 8_000
export const MAX_GROUP_AVAILABILITY_TIMEOUT_MS = 120_000
export const MAX_ACTIVE_GROUP_MEMBERS = 50

const IdentifierSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), {
    message: 'Identifiers must not have leading or trailing whitespace',
  })

export const CandidateIntervalSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((interval, context) => {
    if (Date.parse(interval.start) >= Date.parse(interval.end)) {
      context.addIssue({
        code: 'custom',
        message: 'candidate_interval.start must be before candidate_interval.end',
        path: ['end'],
      })
    }
  })

export type CandidateInterval = z.infer<typeof CandidateIntervalSchema>

export const GroupAvailabilityRequestSchema = z
  .object({
    group_id: IdentifierSchema,
    candidate_interval: CandidateIntervalSchema,
  })
  .strict()

export type GroupAvailabilityRequest = z.infer<typeof GroupAvailabilityRequestSchema>

export const GroupMemberRecordSchema = z
  .object({
    group_member_id: IdentifierSchema,
    group_id: IdentifierSchema,
    person_id: IdentifierSchema,
    active: z.boolean(),
  })
  .strict()

export type GroupMemberRecord = z.infer<typeof GroupMemberRecordSchema>

export const AuthorizedGroupSnapshotSchema = z
  .object({
    group_id: IdentifierSchema,
    membership_revision: z.number().int().nonnegative(),
    active_members: z.array(GroupMemberRecordSchema).min(1).max(MAX_ACTIVE_GROUP_MEMBERS),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const groupMemberIds = new Set<string>()
    const personIds = new Set<string>()

    for (const [index, member] of snapshot.active_members.entries()) {
      if (!member.active) {
        context.addIssue({
          code: 'custom',
          message: 'All snapshot members must be active',
          path: ['active_members', index, 'active'],
        })
      }

      if (member.group_id !== snapshot.group_id) {
        context.addIssue({
          code: 'custom',
          message: 'All snapshot members must belong to the snapshot group',
          path: ['active_members', index, 'group_id'],
        })
      }

      if (groupMemberIds.has(member.group_member_id)) {
        context.addIssue({
          code: 'custom',
          message: 'group_member_id must be unique',
          path: ['active_members', index, 'group_member_id'],
        })
      }
      groupMemberIds.add(member.group_member_id)

      if (personIds.has(member.person_id)) {
        context.addIssue({
          code: 'custom',
          message: 'person_id must be unique',
          path: ['active_members', index, 'person_id'],
        })
      }
      personIds.add(member.person_id)
    }
  })

export type AuthorizedGroupSnapshot = z.infer<typeof AuthorizedGroupSnapshotSchema>

export const GlobalToolIdentitySchema = z
  .object({
    merge_registered_user_id: IdentifierSchema,
  })
  .strict()

export type GlobalToolIdentity = z.infer<typeof GlobalToolIdentitySchema>

export const CalendarPendingReasonSchema = z.enum([
  'reconnect_required',
  'timeout',
  'upstream_error',
])

export type CalendarPendingReason = z.infer<typeof CalendarPendingReasonSchema>

export const PendingReasonSchema = z.enum([
  'missing_identity',
  'reconnect_required',
  'timeout',
  'upstream_error',
  'no_chat_evidence',
])

export type PendingReason = z.infer<typeof PendingReasonSchema>

export const CalendarAvailabilityResponseSchema = z.discriminatedUnion('availability', [
  z.object({ availability: z.literal('free') }).strict(),
  z.object({ availability: z.literal('busy') }).strict(),
  z
    .object({
      availability: z.literal('pending'),
      pending_reason: CalendarPendingReasonSchema,
    })
    .strict(),
])

export type CalendarAvailabilityResponse = z.infer<typeof CalendarAvailabilityResponseSchema>

export const ChatAvailabilityResponseSchema = z
  .object({
    availability: z.enum(['free', 'busy', 'pending']),
  })
  .strict()

export type ChatAvailabilityResponse = z.infer<typeof ChatAvailabilityResponseSchema>

export const GroupAvailabilityMemberResultSchema = z.discriminatedUnion('source', [
  z
    .object({
      group_member_id: IdentifierSchema,
      availability: z.enum(['free', 'busy']),
      source: z.literal('calendar'),
    })
    .strict(),
  z
    .object({
      group_member_id: IdentifierSchema,
      availability: z.enum(['free', 'busy']),
      source: z.literal('chat'),
      calendar_warning: CalendarPendingReasonSchema.optional(),
    })
    .strict(),
  z
    .object({
      group_member_id: IdentifierSchema,
      availability: z.literal('pending'),
      source: z.literal('none'),
      pending_reason: PendingReasonSchema,
      calendar_warning: CalendarPendingReasonSchema.optional(),
    })
    .strict(),
])

export type GroupAvailabilityMemberResult = z.infer<typeof GroupAvailabilityMemberResultSchema>

export const GroupAvailabilityResultSchema = z
  .object({
    group_id: IdentifierSchema,
    membership_revision: z.number().int().nonnegative(),
    members: z
      .array(GroupAvailabilityMemberResultSchema)
      .min(1)
      .max(MAX_ACTIVE_GROUP_MEMBERS)
      .superRefine((members, context) => {
        const groupMemberIds = new Set<string>()

        for (const [index, member] of members.entries()) {
          if (groupMemberIds.has(member.group_member_id)) {
            context.addIssue({
              code: 'custom',
              message: 'group_member_id must be unique',
              path: [index, 'group_member_id'],
            })
          }
          groupMemberIds.add(member.group_member_id)
        }
      }),
  })
  .strict()

export type GroupAvailabilityResult = z.infer<typeof GroupAvailabilityResultSchema>

export const GroupAvailabilityCoordinatorOptionsSchema = z
  .object({
    timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(MAX_GROUP_AVAILABILITY_TIMEOUT_MS)
      .default(DEFAULT_GROUP_AVAILABILITY_TIMEOUT_MS),
  })
  .strict()

export type GroupAvailabilityCoordinatorOptions = z.input<
  typeof GroupAvailabilityCoordinatorOptionsSchema
>

export interface AuthorizedMemberQuery {
  group_id: string
  group_member_id: string
  person_id: string
  membership_revision: number
}

export type GlobalToolIdentityQuery = AuthorizedMemberQuery

export interface CalendarAvailabilityQuery extends AuthorizedMemberQuery {
  merge_registered_user_id: string
  candidate_interval: CandidateInterval
}

export interface ChatAvailabilityQuery extends AuthorizedMemberQuery {
  candidate_interval: CandidateInterval
}

export interface GroupAvailabilityDependencies {
  readonly resolveAuthorizedGroupSnapshot: (
    group_id: string,
    signal: AbortSignal,
  ) => Promise<unknown>
  readonly resolveGlobalToolIdentity: (
    query: Readonly<GlobalToolIdentityQuery>,
    signal: AbortSignal,
  ) => Promise<unknown>
  readonly queryCalendarAvailability: (
    query: Readonly<CalendarAvailabilityQuery>,
    signal: AbortSignal,
  ) => Promise<unknown>
  readonly inferChatAvailability: (
    query: Readonly<ChatAvailabilityQuery>,
    signal: AbortSignal,
  ) => Promise<unknown>
}

export class GroupAvailabilityAuthorizationError extends Error {
  readonly code = 'authorization_snapshot_failed' as const

  constructor() {
    super('Group availability authorization failed')
    this.name = 'GroupAvailabilityAuthorizationError'
  }
}

export type CalendarQueryErrorCode = 'timeout' | 'upstream_error'

export class CalendarQueryError extends Error {
  readonly code: CalendarQueryErrorCode

  constructor(code: CalendarQueryErrorCode, message?: string) {
    super(message ?? `Calendar query failed: ${code}`)
    this.name = 'CalendarQueryError'
    this.code = code
  }
}

class GroupAvailabilityDeadlineError extends Error {
  constructor() {
    super('Group availability deadline exceeded')
    this.name = 'GroupAvailabilityDeadlineError'
  }
}

const callDependency = <Result>(
  call: () => Promise<Result>,
  signal: AbortSignal,
): Promise<Result> => {
  if (signal.aborted) {
    return Promise.reject(new GroupAvailabilityDeadlineError())
  }

  const dependencyResult = Promise.resolve().then(() => {
    if (signal.aborted) {
      throw new GroupAvailabilityDeadlineError()
    }
    return call()
  })

  return new Promise((resolve, reject) => {
    let settled = false

    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }

      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => {
      settle(() => {
        reject(new GroupAvailabilityDeadlineError())
      })
    }

    dependencyResult.then(
      (result) => {
        settle(() => {
          resolve(result)
        })
      },
      (error: unknown) => {
        settle(() => {
          reject(error instanceof Error ? error : new CalendarQueryError('upstream_error'))
        })
      },
    )

    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

const classifyDependencyError = (error: unknown): CalendarQueryErrorCode => {
  if (error instanceof CalendarQueryError) {
    return error.code
  }

  if (
    error instanceof GroupAvailabilityDeadlineError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  ) {
    return 'timeout'
  }

  return 'upstream_error'
}

const memberQuery = (
  member: GroupMemberRecord,
  snapshot: AuthorizedGroupSnapshot,
): AuthorizedMemberQuery => ({
  group_id: snapshot.group_id,
  group_member_id: member.group_member_id,
  person_id: member.person_id,
  membership_revision: snapshot.membership_revision,
})

const pendingResult = (
  group_member_id: string,
  pending_reason: PendingReason,
  calendar_warning?: CalendarPendingReason,
): GroupAvailabilityMemberResult => {
  return {
    group_member_id,
    availability: 'pending',
    source: 'none',
    pending_reason,
    ...(calendar_warning === undefined ? {} : { calendar_warning }),
  }
}

const tryChatFallback = async (
  member: GroupMemberRecord,
  snapshot: AuthorizedGroupSnapshot,
  interval: CandidateInterval,
  calendar_warning: CalendarPendingReason | undefined,
  dependencies: GroupAvailabilityDependencies,
  signal: AbortSignal,
): Promise<GroupAvailabilityMemberResult> => {
  let rawChatAvailability: unknown

  try {
    rawChatAvailability = await callDependency(
      () =>
        dependencies.inferChatAvailability(
          {
            ...memberQuery(member, snapshot),
            candidate_interval: interval,
          },
          signal,
        ),
      signal,
    )
  } catch (error) {
    return pendingResult(member.group_member_id, classifyDependencyError(error), calendar_warning)
  }

  const chatAvailability = ChatAvailabilityResponseSchema.safeParse(rawChatAvailability)
  if (!chatAvailability.success) {
    return pendingResult(member.group_member_id, 'upstream_error', calendar_warning)
  }

  if (chatAvailability.data.availability === 'pending') {
    return pendingResult(member.group_member_id, 'no_chat_evidence', calendar_warning)
  }

  const result: GroupAvailabilityMemberResult = {
    group_member_id: member.group_member_id,
    availability: chatAvailability.data.availability,
    source: 'chat',
    ...(calendar_warning === undefined ? {} : { calendar_warning }),
  }
  return result
}

const availabilityForMember = async (
  member: GroupMemberRecord,
  snapshot: AuthorizedGroupSnapshot,
  interval: CandidateInterval,
  dependencies: GroupAvailabilityDependencies,
  signal: AbortSignal,
): Promise<GroupAvailabilityMemberResult> => {
  let rawIdentity: unknown

  try {
    rawIdentity = await callDependency(
      () => dependencies.resolveGlobalToolIdentity(memberQuery(member, snapshot), signal),
      signal,
    )
  } catch (error) {
    const reason = classifyDependencyError(error)
    return tryChatFallback(member, snapshot, interval, reason, dependencies, signal)
  }

  if (rawIdentity === null || rawIdentity === undefined) {
    return tryChatFallback(member, snapshot, interval, undefined, dependencies, signal)
  }

  const identity = GlobalToolIdentitySchema.safeParse(rawIdentity)
  if (!identity.success) {
    return tryChatFallback(member, snapshot, interval, 'upstream_error', dependencies, signal)
  }

  let rawCalendarAvailability: unknown

  try {
    rawCalendarAvailability = await callDependency(
      () =>
        dependencies.queryCalendarAvailability(
          {
            ...memberQuery(member, snapshot),
            merge_registered_user_id: identity.data.merge_registered_user_id,
            candidate_interval: interval,
          },
          signal,
        ),
      signal,
    )
  } catch (error) {
    const reason = classifyDependencyError(error)
    return tryChatFallback(member, snapshot, interval, reason, dependencies, signal)
  }

  const calendarAvailability = CalendarAvailabilityResponseSchema.safeParse(rawCalendarAvailability)
  if (!calendarAvailability.success) {
    return tryChatFallback(member, snapshot, interval, 'upstream_error', dependencies, signal)
  }

  if (calendarAvailability.data.availability === 'pending') {
    return tryChatFallback(
      member,
      snapshot,
      interval,
      calendarAvailability.data.pending_reason,
      dependencies,
      signal,
    )
  }

  return {
    group_member_id: member.group_member_id,
    availability: calendarAvailability.data.availability,
    source: 'calendar',
  }
}

const resolveSnapshot = async (
  group_id: string,
  dependencies: GroupAvailabilityDependencies,
  signal: AbortSignal,
): Promise<AuthorizedGroupSnapshot> => {
  let rawSnapshot: unknown

  try {
    rawSnapshot = await callDependency(
      () => dependencies.resolveAuthorizedGroupSnapshot(group_id, signal),
      signal,
    )
  } catch {
    throw new GroupAvailabilityAuthorizationError()
  }

  const snapshot = AuthorizedGroupSnapshotSchema.safeParse(rawSnapshot)
  if (!snapshot.success || snapshot.data.group_id !== group_id) {
    throw new GroupAvailabilityAuthorizationError()
  }

  return snapshot.data
}

const coordinateWithinDeadline = async (
  request: GroupAvailabilityRequest,
  dependencies: GroupAvailabilityDependencies,
  timeout_ms: number,
): Promise<GroupAvailabilityResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeout_ms)

  try {
    const snapshot = await resolveSnapshot(request.group_id, dependencies, controller.signal)
    const members = await Promise.all(
      snapshot.active_members.map((member) =>
        availabilityForMember(
          member,
          snapshot,
          request.candidate_interval,
          dependencies,
          controller.signal,
        ),
      ),
    )

    return GroupAvailabilityResultSchema.parse({
      group_id: snapshot.group_id,
      membership_revision: snapshot.membership_revision,
      members,
    })
  } finally {
    clearTimeout(timer)
  }
}

export const coordinateGroupAvailability = async (
  request: unknown,
  dependencies: GroupAvailabilityDependencies,
  options: GroupAvailabilityCoordinatorOptions = {},
): Promise<GroupAvailabilityResult> => {
  const parsedRequest = GroupAvailabilityRequestSchema.parse(request)
  const parsedOptions = GroupAvailabilityCoordinatorOptionsSchema.parse(options)

  return coordinateWithinDeadline(parsedRequest, dependencies, parsedOptions.timeout_ms)
}

export const createGroupAvailabilityCoordinator = (
  dependencies: GroupAvailabilityDependencies,
  options: GroupAvailabilityCoordinatorOptions = {},
): ((request: unknown) => Promise<GroupAvailabilityResult>) => {
  const parsedOptions = GroupAvailabilityCoordinatorOptionsSchema.parse(options)

  return (request) => coordinateGroupAvailability(request, dependencies, parsedOptions)
}

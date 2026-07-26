import { describe, expect, it, vi } from 'vitest'

import {
  MergeCalendarError,
  MergeIdentityError,
  buildCalendarToolArguments,
  busyIntervalsOverlapCandidate,
  createMergeAgentHandlerDependencies,
  createMergeCalendarClient,
  createMergeIdentityResolver,
  extractBusyIntervals,
  extractRegisteredUserId,
  findKnownErrorType,
  pickDeclaredField,
  queryCalendarAvailabilityViaClient,
  type CalendarMcpClient,
} from '../../../src/tools/merge-calendar.js'

// NOTE on scope: createMergeCalendarClient's returned function wires the real
// @modelcontextprotocol/sdk Client + StreamableHTTPClientTransport, which
// speaks a specific wire protocol over fetch. Reimplementing that protocol in
// a fetch mock here would mean testing our own guess of the protocol against
// itself, not the real SDK's behavior — exactly what AGENTS.md's testing
// section warns against ("not by hand-writing a fake ... that quietly
// diverges from the real SDK's behavior over time"). All the actual decision
// logic (tool discovery, argument building, output parsing) is extracted into
// queryCalendarAvailabilityViaClient, tested below against a
// Pick<Client, 'listTools' | 'callTool'>-typed fake — the compiler still
// checks that fake against the real SDK's method signatures. Only
// createMergeCalendarClient's synchronous config validation is tested
// directly; its live MCP session wiring is exercised by TASKS.md's P7-2
// manual sandbox dry run, not by unit tests.

const ACCESS_KEY = 'merge-test-super-secret-key'
const PERSON_QUERY = {
  group_id: 'group-a',
  group_member_id: 'group-a-sam',
  person_id: 'sam',
  membership_revision: 3,
}
const CANDIDATE_INTERVAL = {
  start: '2026-08-02T14:00:00-07:00',
  end: '2026-08-02T16:00:00-07:00',
}

function firstCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): Parameters<typeof fetch> {
  const call = fetchMock.mock.calls[0]
  if (call === undefined) {
    throw new Error('expected fetch to have been called at least once')
  }
  return call
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function tool(
  name: string,
  overrides: Partial<{ properties: Record<string, object>; required: string[] }> = {},
) {
  return {
    name,
    inputSchema: {
      type: 'object' as const,
      properties: overrides.properties ?? {
        time_min: { type: 'string' },
        time_max: { type: 'string' },
      },
      required: overrides.required ?? ['time_min', 'time_max'],
    },
  }
}

function fakeClient(overrides: Partial<CalendarMcpClient>): CalendarMcpClient {
  return {
    listTools: overrides.listTools ?? (() => Promise.resolve({ tools: [] })),
    callTool: overrides.callTool ?? (() => Promise.resolve({ content: [] })),
  } as CalendarMcpClient
}

describe('extractRegisteredUserId', () => {
  it('prefers the OpenAPI reference field name when both are present', () => {
    expect(extractRegisteredUserId({ id: 'from-id', registered_user_id: 'from-guide' })).toBe(
      'from-id',
    )
  })

  it('falls back to the prose-guide field name when only it is present', () => {
    expect(extractRegisteredUserId({ registered_user_id: 'from-guide' })).toBe('from-guide')
  })

  it('returns undefined when neither documented field name is present', () => {
    expect(extractRegisteredUserId({})).toBeUndefined()
  })
})

describe('createMergeIdentityResolver', () => {
  it('creates a Registered User with origin_user_id/origin_user_name from person_id', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'ru_123' }, 201))
    const resolve = createMergeIdentityResolver({ access_key: ACCESS_KEY, fetch: fetchMock })

    const result = await resolve(PERSON_QUERY, new AbortController().signal)

    expect(result).toEqual({ merge_registered_user_id: 'ru_123' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = firstCall(fetchMock)
    expect(url).toBe('https://ah-api.merge.dev/api/v1/registered-users/')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('manual')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${ACCESS_KEY}` })
    expect(JSON.parse(init?.body as string)).toEqual({
      origin_user_id: 'sam',
      origin_user_name: 'sam',
    })
  })

  it('accepts status 200 as the idempotent "already exists" response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ registered_user_id: 'ru_existing' }, 200))
    const resolve = createMergeIdentityResolver({ access_key: ACCESS_KEY, fetch: fetchMock })

    await expect(resolve(PERSON_QUERY, new AbortController().signal)).resolves.toEqual({
      merge_registered_user_id: 'ru_existing',
    })
  })

  it.each([301, 302, 307, 308])(
    'treats a %i redirect as a failure, never as success',
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, { status, headers: { location: 'https://attacker.test/steal' } }),
        )
      const resolve = createMergeIdentityResolver({ access_key: ACCESS_KEY, fetch: fetchMock })

      await expect(resolve(PERSON_QUERY, new AbortController().signal)).rejects.toMatchObject({
        code: 'upstream_error',
      })
    },
  )

  it.each([400, 401, 429, 500])('maps HTTP %i to a sanitized upstream_error', async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, status))
    const resolve = createMergeIdentityResolver({ access_key: ACCESS_KEY, fetch: fetchMock })

    const error: unknown = await resolve(PERSON_QUERY, new AbortController().signal).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(MergeIdentityError)
    expect(error).toMatchObject({ code: 'upstream_error' })
  })

  it('rejects a response missing both documented identifier fields', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ origin_user_id: 'sam' }, 201))
    const resolve = createMergeIdentityResolver({ access_key: ACCESS_KEY, fetch: fetchMock })

    await expect(resolve(PERSON_QUERY, new AbortController().signal)).rejects.toMatchObject({
      code: 'upstream_error',
    })
  })

  it('rejects malformed JSON without throwing an unhandled parse error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('not json', { status: 201, headers: { 'content-type': 'application/json' } }),
      )
    const resolve = createMergeIdentityResolver({ access_key: ACCESS_KEY, fetch: fetchMock })

    await expect(resolve(PERSON_QUERY, new AbortController().signal)).rejects.toMatchObject({
      code: 'upstream_error',
    })
  })

  it('never leaks the access key into a thrown error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(`network died, Authorization: Bearer ${ACCESS_KEY}`))
    const resolve = createMergeIdentityResolver({ access_key: ACCESS_KEY, fetch: fetchMock })

    const error: unknown = await resolve(PERSON_QUERY, new AbortController().signal).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(MergeIdentityError)
    expect(String(error)).not.toContain(ACCESS_KEY)
    expect((error as Error).message).not.toContain(ACCESS_KEY)
  })

  it('rejects with timeout when the consumer signal aborts before fetch settles', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const resolve = createMergeIdentityResolver({
      access_key: ACCESS_KEY,
      fetch: fetchMock,
      timeout_ms: 50_000,
    })

    const pending = resolve(PERSON_QUERY, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'timeout' })
  })

  it('rejects a non-HTTPS base_url before any network call', () => {
    expect(() =>
      createMergeIdentityResolver({ access_key: ACCESS_KEY, base_url: 'http://ah-api.merge.dev' }),
    ).toThrow()
  })
})

describe('pickDeclaredField', () => {
  it('returns the first candidate that exists in the declared properties', () => {
    expect(
      pickDeclaredField({ start_time: {}, end_time: {} }, ['time_min', 'start_time', 'start']),
    ).toBe('start_time')
  })

  it('returns undefined when no candidate is declared', () => {
    expect(
      pickDeclaredField({ unrelated_field: {} }, ['time_min', 'start_time', 'start']),
    ).toBeUndefined()
  })

  it('returns undefined when properties themselves are undefined', () => {
    expect(pickDeclaredField(undefined, ['time_min'])).toBeUndefined()
  })
})

describe('buildCalendarToolArguments', () => {
  it('maps the candidate interval onto the declared time_min/time_max fields', () => {
    expect(buildCalendarToolArguments(tool('query_freebusy'), CANDIDATE_INTERVAL)).toEqual({
      time_min: CANDIDATE_INTERVAL.start,
      time_max: CANDIDATE_INTERVAL.end,
    })
  })

  it('maps onto differently-named declared fields when those are what the schema declares', () => {
    expect(
      buildCalendarToolArguments(
        tool('get_user_schedule', {
          properties: { start: {}, end: {} },
          required: ['start', 'end'],
        }),
        CANDIDATE_INTERVAL,
      ),
    ).toEqual({ start: CANDIDATE_INTERVAL.start, end: CANDIDATE_INTERVAL.end })
  })

  it('refuses to guess when neither start nor end field name is recognized', () => {
    expect(
      buildCalendarToolArguments(
        tool('find_meeting_times', { properties: { attendees: {} }, required: ['attendees'] }),
        CANDIDATE_INTERVAL,
      ),
    ).toBeUndefined()
  })

  it('refuses to call when a declared required field cannot be satisfied', () => {
    expect(
      buildCalendarToolArguments(
        tool('query_freebusy', {
          properties: { time_min: {}, time_max: {}, calendar_id: {} },
          required: ['time_min', 'time_max', 'calendar_id'],
        }),
        CANDIDATE_INTERVAL,
      ),
    ).toBeUndefined()
  })
})

describe('extractBusyIntervals', () => {
  it('parses a flat { busy: [...] } shape', () => {
    const busy = [{ start: '2026-08-02T15:00:00Z', end: '2026-08-02T15:30:00Z' }]
    expect(extractBusyIntervals({ busy })).toEqual(busy)
  })

  it('parses and flattens the Google-style { calendars: { id: { busy: [...] } } } shape', () => {
    const busyA = [{ start: '2026-08-02T15:00:00Z', end: '2026-08-02T15:30:00Z' }]
    const busyB = [{ start: '2026-08-02T20:00:00Z', end: '2026-08-02T21:00:00Z' }]
    expect(
      extractBusyIntervals({ calendars: { 'cal-a': { busy: busyA }, 'cal-b': { busy: busyB } } }),
    ).toEqual([...busyA, ...busyB])
  })

  it('returns undefined for an unrecognized shape rather than guessing', () => {
    expect(extractBusyIntervals({ freeSlots: [] })).toBeUndefined()
    expect(extractBusyIntervals(null)).toBeUndefined()
    expect(extractBusyIntervals('busy')).toBeUndefined()
  })
})

describe('busyIntervalsOverlapCandidate', () => {
  const candidateStart = Date.parse('2026-08-02T14:00:00-07:00')
  const candidateEnd = Date.parse('2026-08-02T16:00:00-07:00')

  it('reports true when a busy interval overlaps the candidate window', () => {
    const busy = [{ start: '2026-08-02T15:00:00-07:00', end: '2026-08-02T15:30:00-07:00' }]
    expect(busyIntervalsOverlapCandidate(busy, candidateStart, candidateEnd)).toBe(true)
  })

  it('reports false when busy intervals exist but none overlap', () => {
    const busy = [{ start: '2026-08-02T10:00:00-07:00', end: '2026-08-02T11:00:00-07:00' }]
    expect(busyIntervalsOverlapCandidate(busy, candidateStart, candidateEnd)).toBe(false)
  })

  it('reports false for an empty busy list (confirmed free, not unknown)', () => {
    expect(busyIntervalsOverlapCandidate([], candidateStart, candidateEnd)).toBe(false)
  })

  it('treats a busy interval ending exactly when the candidate starts as non-overlapping', () => {
    const busy = [{ start: '2026-08-02T13:00:00-07:00', end: '2026-08-02T14:00:00-07:00' }]
    expect(busyIntervalsOverlapCandidate(busy, candidateStart, candidateEnd)).toBe(false)
  })

  it('treats a busy interval starting exactly when the candidate ends as non-overlapping', () => {
    const busy = [{ start: '2026-08-02T16:00:00-07:00', end: '2026-08-02T17:00:00-07:00' }]
    expect(busyIntervalsOverlapCandidate(busy, candidateStart, candidateEnd)).toBe(false)
  })

  it('detects overlap when a busy interval fully contains the candidate window', () => {
    const busy = [{ start: '2026-08-02T10:00:00-07:00', end: '2026-08-02T20:00:00-07:00' }]
    expect(busyIntervalsOverlapCandidate(busy, candidateStart, candidateEnd)).toBe(true)
  })

  it('returns undefined rather than false when a busy interval timestamp fails to parse', () => {
    const busy = [{ start: 'not-a-date', end: '2026-08-02T15:30:00-07:00' }]
    expect(busyIntervalsOverlapCandidate(busy, candidateStart, candidateEnd)).toBeUndefined()
  })
})

describe('findKnownErrorType', () => {
  it('finds a known error type nested inside structuredContent', () => {
    expect(findKnownErrorType({ error: { error_type: 'reauth_required' } })).toBe('reauth_required')
  })

  it('finds a known error type embedded in a human-readable text content block', () => {
    expect(
      findKnownErrorType([
        { type: 'text', text: 'Tool call failed: error_type: reauth_required for this connector' },
      ]),
    ).toBe('reauth_required')
  })

  it('returns undefined for unrelated content', () => {
    expect(findKnownErrorType([{ type: 'text', text: 'busy: []' }])).toBeUndefined()
    expect(findKnownErrorType(undefined)).toBeUndefined()
  })

  it('does not infinite-loop on a self-referential (circular) object', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(findKnownErrorType(circular)).toBeUndefined()
  })
})

describe('queryCalendarAvailabilityViaClient', () => {
  it('falls back to reconnect_required when no authenticated calendar tool is discovered', async () => {
    const client = fakeClient({
      listTools: () => Promise.resolve({ tools: [tool('unrelated_tool')] }),
    })

    await expect(queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)).resolves.toEqual({
      availability: 'pending',
      pending_reason: 'reconnect_required',
    })
  })

  it('prefers query_freebusy over get_user_schedule when both are discovered', async () => {
    const callTool = vi.fn().mockResolvedValue({ structuredContent: { busy: [] }, content: [] })
    const client = fakeClient({
      listTools: () =>
        Promise.resolve({ tools: [tool('get_user_schedule'), tool('query_freebusy')] }),
      callTool,
    })

    await queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)

    expect(callTool).toHaveBeenCalledWith({
      name: 'query_freebusy',
      arguments: { time_min: CANDIDATE_INTERVAL.start, time_max: CANDIDATE_INTERVAL.end },
    })
  })

  it('reports free when the discovered tool returns no busy intervals', async () => {
    const client = fakeClient({
      listTools: () => Promise.resolve({ tools: [tool('query_freebusy')] }),
      callTool: () => Promise.resolve({ structuredContent: { busy: [] }, content: [] }),
    })

    await expect(queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)).resolves.toEqual({
      availability: 'free',
    })
  })

  it('reports busy when a returned interval overlaps the candidate window', async () => {
    const client = fakeClient({
      listTools: () => Promise.resolve({ tools: [tool('query_freebusy')] }),
      callTool: () =>
        Promise.resolve({
          structuredContent: {
            busy: [{ start: '2026-08-02T15:00:00-07:00', end: '2026-08-02T15:30:00-07:00' }],
          },
          content: [],
        }),
    })

    await expect(queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)).resolves.toEqual({
      availability: 'busy',
    })
  })

  it('maps a reauth_required tool error to a reconnect_required pending result', async () => {
    const client = fakeClient({
      listTools: () => Promise.resolve({ tools: [tool('query_freebusy')] }),
      callTool: () =>
        Promise.resolve({
          isError: true,
          content: [{ type: 'text', text: 'error_type: reauth_required' }],
        }),
    })

    await expect(queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)).resolves.toEqual({
      availability: 'pending',
      pending_reason: 'reconnect_required',
    })
  })

  it('maps an unrecognized tool error to an upstream_error pending result', async () => {
    const client = fakeClient({
      listTools: () => Promise.resolve({ tools: [tool('query_freebusy')] }),
      callTool: () => Promise.resolve({ isError: true, content: [{ type: 'text', text: 'boom' }] }),
    })

    await expect(queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)).resolves.toEqual({
      availability: 'pending',
      pending_reason: 'upstream_error',
    })
  })

  it('fails safe to upstream_error on an unrecognized successful output shape', async () => {
    const client = fakeClient({
      listTools: () => Promise.resolve({ tools: [tool('query_freebusy')] }),
      callTool: () => Promise.resolve({ structuredContent: { freeSlots: [] }, content: [] }),
    })

    await expect(queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)).resolves.toEqual({
      availability: 'pending',
      pending_reason: 'upstream_error',
    })
  })

  it('refuses to call a tool whose required fields cannot be confidently satisfied', async () => {
    const callTool = vi.fn()
    const client = fakeClient({
      listTools: () =>
        Promise.resolve({
          tools: [
            tool('query_freebusy', { properties: { attendees: {} }, required: ['attendees'] }),
          ],
        }),
      callTool,
    })

    await expect(queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL)).resolves.toEqual({
      availability: 'pending',
      pending_reason: 'upstream_error',
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('translates a rejected listTools call into MergeCalendarError upstream_error', async () => {
    const client = fakeClient({ listTools: () => Promise.reject(new Error('connection reset')) })

    await expect(
      queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL),
    ).rejects.toBeInstanceOf(MergeCalendarError)
    await expect(
      queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL),
    ).rejects.toMatchObject({
      code: 'upstream_error',
    })
  })

  it('translates a rejected callTool call into MergeCalendarError upstream_error', async () => {
    const client = fakeClient({
      listTools: () => Promise.resolve({ tools: [tool('query_freebusy')] }),
      callTool: () => Promise.reject(new Error('connection reset')),
    })

    await expect(
      queryCalendarAvailabilityViaClient(client, CANDIDATE_INTERVAL),
    ).rejects.toMatchObject({
      code: 'upstream_error',
    })
  })
})

describe('createMergeCalendarClient config validation', () => {
  it('rejects an empty tool_pack_id before any connection attempt', () => {
    expect(() => createMergeCalendarClient({ access_key: ACCESS_KEY, tool_pack_id: '' })).toThrow()
  })

  it('rejects an empty access_key before any connection attempt', () => {
    expect(() => createMergeCalendarClient({ access_key: '', tool_pack_id: 'tp_123' })).toThrow()
  })

  it('rejects a non-HTTPS base_url before any connection attempt', () => {
    expect(() =>
      createMergeCalendarClient({
        access_key: ACCESS_KEY,
        tool_pack_id: 'tp_123',
        base_url: 'http://ah-api.merge.dev',
      }),
    ).toThrow()
  })

  it('accepts a valid config and returns a callable function without connecting', () => {
    const queryFn = createMergeCalendarClient({ access_key: ACCESS_KEY, tool_pack_id: 'tp_123' })
    expect(typeof queryFn).toBe('function')
  })
})

describe('createMergeAgentHandlerDependencies', () => {
  it('wires both dependencies from one config, and the identity resolver honors the shared access_key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'ru_wired' }, 201))
    const dependencies = createMergeAgentHandlerDependencies({
      access_key: ACCESS_KEY,
      tool_pack_id: 'tp_123',
      fetch: fetchMock,
    })

    expect(typeof dependencies.resolveGlobalToolIdentity).toBe('function')
    expect(typeof dependencies.queryCalendarAvailability).toBe('function')
    await expect(
      dependencies.resolveGlobalToolIdentity(PERSON_QUERY, new AbortController().signal),
    ).resolves.toEqual({
      merge_registered_user_id: 'ru_wired',
    })
    const [, init] = firstCall(fetchMock)
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${ACCESS_KEY}` })
  })
})

import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type {
  CalendarAvailabilityQuery,
  GlobalToolIdentityQuery,
  GroupAvailabilityDependencies,
} from './group-availability.js'

// Registered User REST management API — see TECH_STACK.md's Merge section.
export const DEFAULT_MERGE_REST_BASE_URL = 'https://ah-api.merge.dev'
export const DEFAULT_MERGE_IDENTITY_TIMEOUT_MS = 8_000
export const DEFAULT_MERGE_CALENDAR_TIMEOUT_MS = 8_000

// Verified 2026-07-25 against live docs.merge.dev: query_freebusy (Google),
// get_user_schedule / find_meeting_times (Outlook) exist by name, but Merge
// documents no input/output schema for any of them. We only trust the exact
// `name` and `inputSchema` a live tools/list call returns (per TECH_STACK.md
// "never construct or guess Merge runtime names or arguments") — this list
// is just the priority order we look for among discovered tools.
const KNOWN_CALENDAR_TOOL_NAMES = [
  'query_freebusy',
  'get_user_schedule',
  'find_meeting_times',
] as const

const boundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum)

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https:\/\//iu.test(value), {
    message: 'URL must use HTTPS',
  })

// --- Errors -----------------------------------------------------------

export type MergeErrorCode = 'timeout' | 'upstream_error'

export class MergeIdentityError extends Error {
  readonly code: MergeErrorCode

  constructor(code: MergeErrorCode, message?: string) {
    super(message ?? `Merge identity lookup failed: ${code}`)
    this.name = 'MergeIdentityError'
    this.code = code
  }
}

export class MergeCalendarError extends Error {
  readonly code: MergeErrorCode

  constructor(code: MergeErrorCode, message?: string) {
    super(message ?? `Merge calendar query failed: ${code}`)
    this.name = 'MergeCalendarError'
    this.code = code
  }
}

// @modelcontextprotocol/sdk@1.29.0's StreamableHTTPClientTransport only
// merges `requestInit` (including `redirect`) into the fetch calls its POST
// path makes (send()); the standalone GET it issues to open its SSE stream
// (_startOrAuthSse) calls the raw injected `fetch` option directly,
// bypassing `requestInit` entirely — verified against
// dist/esm/client/streamableHttp.js. That GET still carries the bearer
// token (via _commonHeaders()), so without this wrapper a same-origin
// redirect on that specific request would silently forward the credential
// with `requestInit.redirect: 'manual'` having no effect. Wrapping the base
// fetch itself, rather than relying on requestInit, forces redirect:
// 'manual' on every call the transport makes, regardless of which internal
// path constructs the request.
function createRedirectSafeFetch(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => baseFetch(input, { ...init, redirect: 'manual' })
}

// --- Shared deadline helper ---------------------------------------------
// Races an operation against BOTH the caller's AbortSignal (the coordinator's
// shared deadline) and this call's own internal timeout, and guarantees the
// abort listener is always removed. Mirrors the pattern already reviewed in
// web-search.ts / group-availability.ts — kept local rather than shared
// across files since each adapter's cleanup semantics differ. This helper
// only decides when to stop *waiting*; cleaning up whatever the operation
// opened (e.g. an MCP client/transport) is each call site's own
// responsibility via try/finally around the call to this function.
function raceAgainstDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  consumerSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const forwardAbort = (): void => {
    controller.abort()
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    // Declared before anything that could synchronously trigger settle()
    // below (an already-aborted consumerSignal causes a synchronous abort
    // cascade through forwardAbort -> controller.abort() -> onTimeoutOrAbort
    // -> settle, which reads `timer`) — must exist by then.
    const timer = setTimeout(forwardAbort, timeoutMs)
    const settle = (run: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      consumerSignal.removeEventListener('abort', forwardAbort)
      controller.signal.removeEventListener('abort', onTimeoutOrAbort)
      run()
    }
    const onTimeoutOrAbort = (): void => {
      settle(() => {
        reject(new MergeCalendarError('timeout'))
      })
    }
    // Attached before checking/forwarding consumerSignal so an
    // already-aborted consumerSignal still reaches onTimeoutOrAbort: the
    // 'abort' event only fires once, at the moment abort() is called, so a
    // listener added after that point would never see it.
    controller.signal.addEventListener('abort', onTimeoutOrAbort, { once: true })

    if (consumerSignal.aborted) {
      forwardAbort()
    } else {
      consumerSignal.addEventListener('abort', forwardAbort, { once: true })
    }

    operation(controller.signal).then(
      (value) => {
        settle(() => {
          resolve(value)
        })
      },
      (error: unknown) => {
        settle(() => {
          reject(error instanceof Error ? error : new MergeCalendarError('upstream_error'))
        })
      },
    )
  })
}

// --- Registered User identity resolution --------------------------------

// Merge's prose guide (docs.merge.dev/merge-agent-handler/build/users/registered-users)
// documents the created identifier as `registered_user_id`; the OpenAPI
// reference page (.../registered-users/registered-users-create) documents it
// as `id`. Verified 2026-07-25 — both are real, disagreeing sources. Accept
// either field, ignore the rest of the (differently-shaped) documented body.
const RegisteredUserResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    registered_user_id: z.string().min(1).optional(),
  })
  .passthrough()

export function extractRegisteredUserId(
  response: z.infer<typeof RegisteredUserResponseSchema>,
): string | undefined {
  return response.id ?? response.registered_user_id
}

const MergeIdentityResolverConfigSchema = z
  .object({
    access_key: boundedText(1, 500),
    base_url: HttpsUrlSchema.default(DEFAULT_MERGE_REST_BASE_URL),
    timeout_ms: z.number().int().min(1).max(120_000).default(DEFAULT_MERGE_IDENTITY_TIMEOUT_MS),
    fetch: z
      .custom<typeof globalThis.fetch>((value: unknown) => typeof value === 'function')
      .optional(),
  })
  .strict()

export interface MergeIdentityResolverConfig {
  access_key: string
  base_url?: string
  timeout_ms?: number
  fetch?: typeof globalThis.fetch
}

export type ResolveGlobalToolIdentity = GroupAvailabilityDependencies['resolveGlobalToolIdentity']

// Person display names aren't available on AuthorizedMemberQuery today (no
// profile-name lookup is wired into the Tools lane) — origin_user_name is
// set to person_id. Replace once a name source exists; Merge only requires
// the field to be a non-empty string, not a verified human name.
export function createMergeIdentityResolver(
  config: MergeIdentityResolverConfig,
): ResolveGlobalToolIdentity {
  const parsed = MergeIdentityResolverConfigSchema.parse(config)
  const fetchImpl = parsed.fetch ?? globalThis.fetch
  const endpoint = `${parsed.base_url.replace(/\/+$/, '')}/api/v1/registered-users/`

  return async (
    query: Readonly<GlobalToolIdentityQuery>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    return raceAgainstDeadline(
      async (raceSignal) => {
        let response: Response
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${parsed.access_key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              origin_user_id: query.person_id,
              origin_user_name: query.person_id,
            }),
            // Never follow a redirect on a request carrying a bearer token —
            // an attacker-configured/compromised base_url could otherwise
            // redirect the credential to a different host.
            redirect: 'manual',
            signal: raceSignal,
          })
        } catch {
          if (raceSignal.aborted) {
            throw new MergeIdentityError('timeout')
          }
          throw new MergeIdentityError('upstream_error')
        }

        // Idempotent per docs.merge.dev/merge-agent-handler/agent-handler:
        // 200 = existing Registered User, 201 = newly created. A redirect
        // response (3xx) is treated as failure per the redirect:'manual'
        // policy above, not followed.
        if (response.status !== 200 && response.status !== 201) {
          throw new MergeIdentityError('upstream_error')
        }

        let body: unknown
        try {
          body = await response.json()
        } catch {
          throw new MergeIdentityError('upstream_error')
        }

        const validated = RegisteredUserResponseSchema.safeParse(body)
        if (!validated.success) {
          throw new MergeIdentityError('upstream_error')
        }
        const registeredUserId = extractRegisteredUserId(validated.data)
        if (registeredUserId === undefined) {
          throw new MergeIdentityError('upstream_error')
        }
        return { merge_registered_user_id: registeredUserId }
      },
      signal,
      parsed.timeout_ms,
    )
  }
}

// --- Calendar availability via MCP ---------------------------------------

const CandidateBusyIntervalSchema = z
  .object({
    start: z.string(),
    end: z.string(),
  })
  .passthrough()

// Google Calendar's native freebusy.query response shape
// (`calendars: { [calendarId]: { busy: [{start, end}] } }`) — Merge
// documents query_freebusy only as "a thin connector passthrough," with no
// published output schema of its own (verified 2026-07-25: no shape is
// documented on docs.merge.dev for this tool). This is the one shape we
// have real confidence in; anything else safely falls back to chat
// inference rather than being fabricated.
const GoogleFreeBusyShapeSchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({ busy: z.array(CandidateBusyIntervalSchema) }).passthrough(),
  ),
})

const FlatBusyShapeSchema = z.object({
  busy: z.array(CandidateBusyIntervalSchema),
})

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

export function busyIntervalsOverlapCandidate(
  busy: ReadonlyArray<{ start: string; end: string }>,
  candidateStart: number,
  candidateEnd: number,
): boolean | undefined {
  for (const interval of busy) {
    const start = Date.parse(interval.start)
    const end = Date.parse(interval.end)
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return undefined
    }
    if (intervalsOverlap(start, end, candidateStart, candidateEnd)) {
      return true
    }
  }
  return false
}

export function extractBusyIntervals(
  value: unknown,
): ReadonlyArray<{ start: string; end: string }> | undefined {
  const flat = FlatBusyShapeSchema.safeParse(value)
  if (flat.success) {
    return flat.data.busy
  }
  const google = GoogleFreeBusyShapeSchema.safeParse(value)
  if (google.success) {
    return Object.values(google.data.calendars).flatMap((calendar) => calendar.busy)
  }
  return undefined
}

const KNOWN_TOOL_ERROR_TYPES = [
  'reauth_required',
  'rate_limit_exceeded',
  'billing_limit_reached',
  'unauthorized_tool',
] as const

// docs.merge.dev/merge-agent-handler/resources/troubleshooting only shows
// this token in prose ("error with `error_type: reauth_required`"), not a
// documented JSON shape — so match it as a substring of any string found
// anywhere in the result, not just an exact field-value match, to catch
// both a structured `{error_type: 'reauth_required'}` and a human-readable
// text content block that happens to mention it.
export function findKnownErrorType(value: unknown, seen = new Set<unknown>()): string | undefined {
  if (typeof value === 'string') {
    return KNOWN_TOOL_ERROR_TYPES.find((errorType) => value.includes(errorType))
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return undefined
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKnownErrorType(item, seen)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const found = findKnownErrorType(entry, seen)
    if (found !== undefined) return found
  }
  return undefined
}

// Start/end candidate field names to look for in a live inputSchema, in
// priority order. We only ever send a field name the server's own
// discovered inputSchema declared — never a guessed name outright — per
// TECH_STACK.md's "never construct or guess Merge runtime arguments."
const START_FIELD_CANDIDATES = ['time_min', 'start_time', 'start', 'from'] as const
const END_FIELD_CANDIDATES = ['time_max', 'end_time', 'end', 'to'] as const

export function pickDeclaredField(
  properties: Record<string, unknown> | undefined,
  candidates: readonly string[],
): string | undefined {
  if (properties === undefined) return undefined
  return candidates.find((candidate) => candidate in properties)
}

export function buildCalendarToolArguments(
  tool: Tool,
  interval: { start: string; end: string },
): Record<string, unknown> | undefined {
  const properties = tool.inputSchema.properties as Record<string, unknown> | undefined
  const startField = pickDeclaredField(properties, START_FIELD_CANDIDATES)
  const endField = pickDeclaredField(properties, END_FIELD_CANDIDATES)
  const required = tool.inputSchema.required ?? []

  if (startField === undefined || endField === undefined) {
    // Neither a recognized start nor end field name is declared — refuse to
    // guess regardless of whether the tool has other required fields. The
    // caller falls back to chat inference.
    return undefined
  }

  const args: Record<string, unknown> = {
    [startField]: interval.start,
    [endField]: interval.end,
  }

  for (const requiredField of required) {
    if (!(requiredField in args)) {
      // A required field we don't know how to satisfy exists — abort rather
      // than send an incomplete/guessed call.
      return undefined
    }
  }

  return args
}

const MergeCalendarClientConfigSchema = z
  .object({
    access_key: boundedText(1, 500),
    tool_pack_id: boundedText(1, 200),
    base_url: HttpsUrlSchema.default(DEFAULT_MERGE_REST_BASE_URL),
    timeout_ms: z.number().int().min(1).max(120_000).default(DEFAULT_MERGE_CALENDAR_TIMEOUT_MS),
    fetch: z
      .custom<typeof globalThis.fetch>((value: unknown) => typeof value === 'function')
      .optional(),
  })
  .strict()

export interface MergeCalendarClientConfig {
  access_key: string
  tool_pack_id: string
  base_url?: string
  timeout_ms?: number
  fetch?: typeof globalThis.fetch
}

export type QueryCalendarAvailability = GroupAvailabilityDependencies['queryCalendarAvailability']

// The MCP session-management glue (connect/close) is thin, SDK-typed, and
// not meaningfully unit-testable without reimplementing the StreamableHTTP
// wire protocol. All the actual decision logic — tool discovery, argument
// building from a live inputSchema, error/output parsing — lives here,
// behind a minimal Pick<Client, ...> so tests can supply a fake that the
// compiler still checks against the real SDK's method signatures.
export type CalendarMcpClient = Pick<Client, 'listTools' | 'callTool'>

export async function queryCalendarAvailabilityViaClient(
  client: CalendarMcpClient,
  candidateInterval: { start: string; end: string },
  signal?: AbortSignal,
): Promise<unknown> {
  const listed = await client.listTools(undefined, { signal }).catch(() => {
    throw new MergeCalendarError('upstream_error')
  })

  const tool = KNOWN_CALENDAR_TOOL_NAMES.map((name) =>
    listed.tools.find((candidate) => candidate.name === name),
  ).find((candidate): candidate is Tool => candidate !== undefined)

  if (tool === undefined) {
    // No authenticated calendar connector discovered for this person — per
    // TECH_STACK.md, use same-group chat inference.
    return { availability: 'pending', pending_reason: 'reconnect_required' }
  }

  const toolArguments = buildCalendarToolArguments(tool, candidateInterval)
  if (toolArguments === undefined) {
    return { availability: 'pending', pending_reason: 'upstream_error' }
  }

  const result = await client
    .callTool({ name: tool.name, arguments: toolArguments }, undefined, { signal })
    .catch(() => {
      throw new MergeCalendarError('upstream_error')
    })

  const knownErrorType =
    findKnownErrorType(result.structuredContent) ?? findKnownErrorType(result.content)
  if (result.isError === true || knownErrorType !== undefined) {
    return {
      availability: 'pending',
      pending_reason:
        knownErrorType === 'reauth_required' ? 'reconnect_required' : 'upstream_error',
    }
  }

  const busy = extractBusyIntervals(result.structuredContent)
  if (busy === undefined) {
    // Output shape for this tool isn't documented (verified 2026-07-25) and
    // didn't match the one shape we trust — fail safe rather than report a
    // fabricated availability.
    return { availability: 'pending', pending_reason: 'upstream_error' }
  }

  const candidateStart = Date.parse(candidateInterval.start)
  const candidateEnd = Date.parse(candidateInterval.end)
  const overlap = busyIntervalsOverlapCandidate(busy, candidateStart, candidateEnd)
  if (overlap === undefined) {
    return { availability: 'pending', pending_reason: 'upstream_error' }
  }
  return { availability: overlap ? 'busy' : 'free' }
}

export function createMergeCalendarClient(
  config: MergeCalendarClientConfig,
): QueryCalendarAvailability {
  const parsed = MergeCalendarClientConfigSchema.parse(config)

  return async (
    query: Readonly<CalendarAvailabilityQuery>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const endpointUrl = new URL(
      `${parsed.base_url.replace(/\/+$/, '')}/api/v1/tool-packs/${encodeURIComponent(
        parsed.tool_pack_id,
      )}/registered-users/${encodeURIComponent(query.merge_registered_user_id)}/mcp/`,
    )
    endpointUrl.searchParams.set('authenticated_only', 'true')

    let client: Client | undefined

    try {
      return await raceAgainstDeadline(
        async (raceSignal) => {
          const transport = new StreamableHTTPClientTransport(endpointUrl, {
            requestInit: {
              headers: { Authorization: `Bearer ${parsed.access_key}` },
            },
            fetch: createRedirectSafeFetch(parsed.fetch ?? globalThis.fetch),
          })
          client = new Client({ name: 'corgi-merge-calendar-client', version: '0.1.0' })

          try {
            await client.connect(transport, { signal: raceSignal })
          } catch {
            throw new MergeCalendarError('upstream_error')
          }

          return await queryCalendarAvailabilityViaClient(
            client,
            query.candidate_interval,
            raceSignal,
          )
        },
        signal,
        parsed.timeout_ms,
      )
    } finally {
      await client?.close().catch(() => undefined)
    }
  }
}

// --- Convenience wiring ----------------------------------------------

export interface MergeAgentHandlerConfig {
  access_key: string
  tool_pack_id: string
  base_url?: string
  identity_timeout_ms?: number
  calendar_timeout_ms?: number
  fetch?: typeof globalThis.fetch
}

// Produces the two dependencies createGroupAvailabilityCoordinator expects
// for the "connected calendar" path — chat-text inference remains a
// separately-injected dependency (Claude reasoning, Phase 3, not this file's
// concern).
export function createMergeAgentHandlerDependencies(
  config: MergeAgentHandlerConfig,
): Pick<GroupAvailabilityDependencies, 'resolveGlobalToolIdentity' | 'queryCalendarAvailability'> {
  return {
    resolveGlobalToolIdentity: createMergeIdentityResolver({
      access_key: config.access_key,
      ...(config.base_url === undefined ? {} : { base_url: config.base_url }),
      ...(config.identity_timeout_ms === undefined
        ? {}
        : { timeout_ms: config.identity_timeout_ms }),
      ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    }),
    queryCalendarAvailability: createMergeCalendarClient({
      access_key: config.access_key,
      tool_pack_id: config.tool_pack_id,
      ...(config.base_url === undefined ? {} : { base_url: config.base_url }),
      ...(config.calendar_timeout_ms === undefined
        ? {}
        : { timeout_ms: config.calendar_timeout_ms }),
      ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    }),
  }
}

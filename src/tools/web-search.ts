import { z } from 'zod'

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
export const DEFAULT_TAVILY_TIMEOUT_MS = 8_000
export const DEFAULT_TAVILY_MAX_RESULTS = 5
export const MAX_TAVILY_QUERY_LENGTH = 400
export const MAX_TAVILY_CACHE_ENTRIES = 256
export const VENUE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000
export const EVENT_CACHE_TTL_MS = 15 * 60 * 1_000

const DEFAULT_TAVILY_BASE_URL = 'https://api.tavily.com'
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

const boundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum)
const ProviderRequestIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/)
export const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//iu.test(value), {
    message: 'URL must use HTTP or HTTPS',
  })
const HttpsUrlSchema = HttpUrlSchema.refine((value) => /^https:\/\//iu.test(value), {
  message: 'URL must use HTTPS',
})

export const CostTierSchema = z.enum(['free', 'low', 'medium', 'high'])
export type CostTier = z.infer<typeof CostTierSchema>

const CommonSearchInputShape = {
  query: boundedText(2, 300),
  locality: boundedText(1, 120),
  region: boundedText(1, 120).optional(),
  country: boundedText(1, 120).optional(),
  categories: z.array(boundedText(1, 80)).max(5).optional(),
  cost_tier: CostTierSchema.optional(),
  max_results: z.number().int().min(1).max(10).default(DEFAULT_TAVILY_MAX_RESULTS),
}

export const VenueSearchInputSchema = z.object(CommonSearchInputShape).strict()
export type VenueSearchInput = z.input<typeof VenueSearchInputSchema>

export const EventSearchInputSchema = z
  .object({
    ...CommonSearchInputShape,
    starts_on: z.string().date(),
    ends_on: z.string().date(),
  })
  .strict()
  .refine((input) => input.ends_on >= input.starts_on, {
    message: 'ends_on must be on or after starts_on',
    path: ['ends_on'],
  })
export type EventSearchInput = z.input<typeof EventSearchInputSchema>

const TavilyImageSchema = z.union([
  HttpUrlSchema,
  z
    .object({
      url: HttpUrlSchema,
      description: z.string(),
    })
    .strict(),
])

export const TavilySearchSuccessSchema = z
  .object({
    query: z.string().min(1).max(MAX_TAVILY_QUERY_LENGTH),
    answer: z.string().nullable().optional(),
    images: z.array(TavilyImageSchema).optional(),
    results: z.array(
      z
        .object({
          title: z.string(),
          url: HttpUrlSchema,
          content: z.string(),
          score: z.number().min(0).max(1),
          raw_content: z.string().nullable().optional(),
          favicon: HttpUrlSchema.nullable().optional(),
          images: z.array(TavilyImageSchema).optional(),
        })
        .strict(),
    ),
    response_time: z.union([
      z.number().nonnegative(),
      z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
    ]),
    auto_parameters: z
      .object({
        topic: z.enum(['general', 'news', 'finance']).optional(),
        search_depth: z.enum(['advanced', 'basic', 'fast', 'ultra-fast']).optional(),
      })
      .strict()
      .optional(),
    usage: z
      .object({
        credits: z.number().nonnegative(),
      })
      .strict(),
    request_id: ProviderRequestIdSchema,
  })
  .strict()
export type TavilySearchSuccess = z.infer<typeof TavilySearchSuccessSchema>

export const SearchEvidenceResultSchema = z
  .object({
    ref_id: boundedText(1, 2_000),
    title: z.string(),
    source_url: HttpUrlSchema,
    summary: z.string(),
    relevance_score: z.number().min(0).max(1),
  })
  .strict()
export type SearchEvidenceResult = z.infer<typeof SearchEvidenceResultSchema>

export const SearchEvidenceSchema = z
  .object({
    provider: z.literal('tavily'),
    source_tool: z.enum(['search_venues', 'search_events']),
    query: boundedText(1, MAX_TAVILY_QUERY_LENGTH),
    results: z.array(SearchEvidenceResultSchema).max(10),
    retrieved_at: z.string().datetime(),
    provider_request_id: ProviderRequestIdSchema,
    credits_used: z.number().nonnegative(),
    cache_hit: z.boolean(),
  })
  .strict()
export type SearchEvidence = z.infer<typeof SearchEvidenceSchema>

export type TavilySearchErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'timeout'
  | 'network'
  | 'upstream'
  | 'invalid_response'

export interface TavilySearchErrorMetadata {
  status?: number | undefined
  retryable?: boolean | undefined
  retry_after_ms?: number | undefined
  provider_request_id?: string | undefined
}

export interface TavilySearchErrorJson {
  name: 'TavilySearchError'
  code: TavilySearchErrorCode
  message: string
  status?: number
  retryable?: boolean
  retry_after_ms?: number
  provider_request_id?: string
}

const ERROR_MESSAGES: Readonly<Record<TavilySearchErrorCode, string>> = {
  invalid_request: 'Tavily search request is invalid',
  unauthorized: 'Tavily search authentication failed',
  rate_limited: 'Tavily search rate limit exceeded',
  quota_exhausted: 'Tavily search quota is exhausted',
  timeout: 'Tavily search timed out',
  network: 'Tavily search network request failed',
  upstream: 'Tavily search service failed',
  invalid_response: 'Tavily search returned an invalid response',
}

export class TavilySearchError extends Error {
  readonly code: TavilySearchErrorCode
  readonly status: number | undefined
  readonly retryable: boolean | undefined
  readonly retry_after_ms: number | undefined
  readonly provider_request_id: string | undefined

  constructor(code: TavilySearchErrorCode, metadata: TavilySearchErrorMetadata = {}) {
    super(ERROR_MESSAGES[code])
    this.name = 'TavilySearchError'
    this.code = code
    this.status =
      metadata.status !== undefined &&
      Number.isInteger(metadata.status) &&
      metadata.status >= 100 &&
      metadata.status <= 599
        ? metadata.status
        : undefined
    this.retryable = typeof metadata.retryable === 'boolean' ? metadata.retryable : undefined
    this.retry_after_ms =
      typeof metadata.retry_after_ms === 'number' &&
      Number.isFinite(metadata.retry_after_ms) &&
      metadata.retry_after_ms >= 0
        ? metadata.retry_after_ms
        : undefined
    this.provider_request_id = safeProviderRequestId(metadata.provider_request_id)
  }

  toJSON(): TavilySearchErrorJson {
    return {
      name: 'TavilySearchError',
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.retryable === undefined ? {} : { retryable: this.retryable }),
      ...(this.retry_after_ms === undefined ? {} : { retry_after_ms: this.retry_after_ms }),
      ...(this.provider_request_id === undefined
        ? {}
        : { provider_request_id: this.provider_request_id }),
    }
  }
}

export type TavilySleep = (milliseconds: number, signal: AbortSignal) => Promise<void>

export interface TavilySearchAdapterConfig {
  api_key: string
  base_url?: string
  timeout_ms?: number
  cache?: boolean
  max_entries?: number
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: TavilySleep
}

export interface TavilySearchOptions {
  signal?: AbortSignal
}

export interface TavilySearchAdapter {
  searchVenues(input: VenueSearchInput, options?: TavilySearchOptions): Promise<SearchEvidence>
  searchEvents(input: EventSearchInput, options?: TavilySearchOptions): Promise<SearchEvidence>
}

const FetchSchema = z.custom<typeof globalThis.fetch>((value) => typeof value === 'function')
const NowSchema = z.custom<() => number>((value) => typeof value === 'function')
const SleepSchema = z.custom<TavilySleep>((value) => typeof value === 'function')
const AbortSignalSchema = z.custom<AbortSignal>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof value.aborted === 'boolean' &&
    'addEventListener' in value &&
    typeof value.addEventListener === 'function' &&
    'removeEventListener' in value &&
    typeof value.removeEventListener === 'function',
)

const TavilySearchAdapterConfigSchema = z
  .object({
    api_key: boundedText(1, 500),
    base_url: HttpsUrlSchema.default(DEFAULT_TAVILY_BASE_URL),
    timeout_ms: z.number().int().min(1).max(120_000).default(DEFAULT_TAVILY_TIMEOUT_MS),
    cache: z.boolean().default(true),
    max_entries: z
      .number()
      .int()
      .min(1)
      .max(MAX_TAVILY_CACHE_ENTRIES)
      .default(MAX_TAVILY_CACHE_ENTRIES),
    fetch: FetchSchema.optional(),
    now: NowSchema.optional(),
    sleep: SleepSchema.optional(),
  })
  .strict()

const TavilySearchOptionsSchema = z
  .object({
    signal: AbortSignalSchema.optional(),
  })
  .strict()

type SourceTool = SearchEvidence['source_tool']

interface CacheEntry {
  evidence: SearchEvidence
  expires_at: number
}

interface NormalizedConfig {
  api_key: string
  search_url: string
  timeout_ms: number
  cache: boolean
  max_entries: number
  fetch: typeof globalThis.fetch
  now: () => number
  sleep: TavilySleep
}

function invalidRequest(): TavilySearchError {
  return new TavilySearchError('invalid_request')
}

function parseConfig(config: TavilySearchAdapterConfig): NormalizedConfig {
  const parsed = TavilySearchAdapterConfigSchema.safeParse(config)
  if (!parsed.success) {
    throw invalidRequest()
  }

  const fetchImplementation = parsed.data.fetch ?? globalThis.fetch
  if (typeof fetchImplementation !== 'function') {
    throw invalidRequest()
  }

  const baseUrl = parsed.data.base_url.replace(/\/+$/, '')
  return {
    api_key: parsed.data.api_key,
    search_url: `${baseUrl}/search`,
    timeout_ms: parsed.data.timeout_ms,
    cache: parsed.data.cache,
    max_entries: parsed.data.max_entries,
    fetch: fetchImplementation,
    now: parsed.data.now ?? Date.now,
    sleep: parsed.data.sleep ?? defaultSleep,
  }
}

function parseOptions(options: TavilySearchOptions | undefined): TavilySearchOptions {
  const parsed = TavilySearchOptionsSchema.safeParse(options ?? {})
  if (!parsed.success) {
    throw invalidRequest()
  }
  return parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }
}

function place(input: {
  locality: string
  region?: string | undefined
  country?: string | undefined
}): string {
  return [input.locality, input.region, input.country]
    .filter((part): part is string => part !== undefined)
    .join(', ')
}

function qualifiers(input: {
  categories?: string[] | undefined
  cost_tier?: CostTier | undefined
}): string {
  const parts: string[] = []
  if (input.categories !== undefined && input.categories.length > 0) {
    parts.push(`categories: ${[...input.categories].sort().join(', ')}`)
  }
  if (input.cost_tier !== undefined) {
    parts.push(`cost tier: ${input.cost_tier}`)
  }
  return parts.length === 0 ? '' : `; ${parts.join('; ')}`
}

function validateComposedQuery(query: string): string {
  if (query.length > MAX_TAVILY_QUERY_LENGTH) {
    throw invalidRequest()
  }
  return query
}

export function buildVenueSearchQuery(input: VenueSearchInput): string {
  const parsed = VenueSearchInputSchema.safeParse(input)
  if (!parsed.success) {
    throw invalidRequest()
  }
  return validateComposedQuery(
    `${parsed.data.query} venues in ${place(parsed.data)}${qualifiers(parsed.data)}`,
  )
}

export function buildEventSearchQuery(input: EventSearchInput): string {
  const parsed = EventSearchInputSchema.safeParse(input)
  if (!parsed.success) {
    throw invalidRequest()
  }
  return validateComposedQuery(
    `${parsed.data.query} events in ${place(parsed.data)}; event dates: ${parsed.data.starts_on} through ${parsed.data.ends_on}${qualifiers(parsed.data)}`,
  )
}

function cloneEvidence(evidence: SearchEvidence, cacheHit: boolean): SearchEvidence {
  return {
    ...evidence,
    results: evidence.results.map((result) => ({ ...result })),
    cache_hit: cacheHit,
    credits_used: cacheHit ? 0 : evidence.credits_used,
  }
}

function statusError(
  status: number,
  retryAfterMilliseconds: number | undefined,
  providerRequestId: string | undefined,
): TavilySearchError {
  const metadata: TavilySearchErrorMetadata = {
    status,
    retryable: RETRYABLE_STATUS_CODES.has(status),
    ...(retryAfterMilliseconds === undefined ? {} : { retry_after_ms: retryAfterMilliseconds }),
    ...(providerRequestId === undefined ? {} : { provider_request_id: providerRequestId }),
  }
  switch (status) {
    case 400:
      return new TavilySearchError('invalid_request', metadata)
    case 401:
      return new TavilySearchError('unauthorized', metadata)
    case 429:
      return new TavilySearchError('rate_limited', metadata)
    case 432:
    case 433:
      return new TavilySearchError('quota_exhausted', metadata)
    default:
      return new TavilySearchError('upstream', metadata)
  }
}

function parseRetryAfter(value: string | null, nowMilliseconds: number): number | undefined {
  if (value === null) {
    return undefined
  }

  const trimmed = value.trim()
  if (/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds) ? seconds * 1_000 : undefined
  }

  const retryAt = Date.parse(trimmed)
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMilliseconds) : undefined
}

function safeProviderRequestId(value: string | undefined): string | undefined {
  const parsed = ProviderRequestIdSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function responseRequestId(
  response: Response,
  prohibitedValues: readonly string[],
): string | undefined {
  const requestId = safeProviderRequestId(
    response.headers.get('x-request-id') ??
      response.headers.get('tavily-request-id') ??
      response.headers.get('request-id') ??
      undefined,
  )
  if (
    requestId === undefined ||
    prohibitedValues.some((value) => value.length > 0 && requestId.includes(value))
  ) {
    return undefined
  }
  return requestId
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new TavilySearchError('timeout'))
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new TavilySearchError('timeout'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error('Asynchronous operation failed'))
      },
    )
  })
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new TavilySearchError('timeout'))
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new TavilySearchError('timeout'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizeEvidence(
  response: TavilySearchSuccess,
  sourceTool: SourceTool,
  query: string,
  maxResults: number,
  retrievedAt: string,
): SearchEvidence {
  if (response.query !== query) {
    throw new TavilySearchError('invalid_response')
  }

  const normalized = SearchEvidenceSchema.safeParse({
    provider: 'tavily',
    source_tool: sourceTool,
    query,
    results: response.results.slice(0, maxResults).map((result, index) => ({
      ref_id: `tavily:${response.request_id}:${String(index + 1)}`,
      title: result.title,
      source_url: result.url,
      summary: result.content,
      relevance_score: result.score,
    })),
    retrieved_at: retrievedAt,
    provider_request_id: response.request_id,
    credits_used: response.usage.credits,
    cache_hit: false,
  })
  if (!normalized.success) {
    throw new TavilySearchError('invalid_response')
  }
  return normalized.data
}

class TavilySearchAdapterImplementation implements TavilySearchAdapter {
  readonly #config: NormalizedConfig
  readonly #cache = new Map<string, CacheEntry>()
  readonly #inFlight = new Map<string, Promise<SearchEvidence>>()

  constructor(config: TavilySearchAdapterConfig) {
    this.#config = parseConfig(config)
  }

  async searchVenues(
    input: VenueSearchInput,
    options?: TavilySearchOptions,
  ): Promise<SearchEvidence> {
    const parsed = VenueSearchInputSchema.safeParse(input)
    if (!parsed.success) {
      throw invalidRequest()
    }
    return this.#search(
      'search_venues',
      buildVenueSearchQuery(parsed.data),
      parsed.data.max_results,
      VENUE_CACHE_TTL_MS,
      parseOptions(options).signal,
    )
  }

  async searchEvents(
    input: EventSearchInput,
    options?: TavilySearchOptions,
  ): Promise<SearchEvidence> {
    const parsed = EventSearchInputSchema.safeParse(input)
    if (!parsed.success) {
      throw invalidRequest()
    }
    return this.#search(
      'search_events',
      buildEventSearchQuery(parsed.data),
      parsed.data.max_results,
      EVENT_CACHE_TTL_MS,
      parseOptions(options).signal,
    )
  }

  async #search(
    sourceTool: SourceTool,
    query: string,
    maxResults: number,
    ttlMilliseconds: number,
    consumerSignal: AbortSignal | undefined,
  ): Promise<SearchEvidence> {
    if (consumerSignal?.aborted === true) {
      throw new TavilySearchError('timeout')
    }

    const cacheKey = JSON.stringify([sourceTool, query, maxResults])
    const cached = this.#readCache(cacheKey)
    if (cached !== undefined) {
      return cloneEvidence(cached, true)
    }

    let request = this.#inFlight.get(cacheKey)
    if (request === undefined) {
      request = this.#request(sourceTool, query, maxResults).then((evidence) => {
        if (this.#config.cache) {
          this.#writeCache(cacheKey, evidence, ttlMilliseconds)
        }
        return evidence
      })
      this.#inFlight.set(cacheKey, request)
      const cleanUp = () => {
        if (this.#inFlight.get(cacheKey) === request) {
          this.#inFlight.delete(cacheKey)
        }
      }
      void request.then(cleanUp, cleanUp)
    }

    const evidence =
      consumerSignal === undefined ? await request : await raceWithAbort(request, consumerSignal)
    return cloneEvidence(evidence, false)
  }

  #readCache(cacheKey: string): SearchEvidence | undefined {
    if (!this.#config.cache) {
      return undefined
    }

    const cached = this.#cache.get(cacheKey)
    if (cached === undefined) {
      return undefined
    }
    if (cached.expires_at <= this.#config.now()) {
      this.#cache.delete(cacheKey)
      return undefined
    }

    this.#cache.delete(cacheKey)
    this.#cache.set(cacheKey, cached)
    return cached.evidence
  }

  #writeCache(cacheKey: string, evidence: SearchEvidence, ttlMilliseconds: number): void {
    this.#cache.delete(cacheKey)
    this.#cache.set(cacheKey, {
      evidence: cloneEvidence(evidence, false),
      expires_at: this.#config.now() + ttlMilliseconds,
    })

    if (this.#cache.size > this.#config.max_entries) {
      const leastRecentlyUsed = this.#cache.keys().next().value
      if (leastRecentlyUsed !== undefined) {
        this.#cache.delete(leastRecentlyUsed)
      }
    }
  }

  async #request(
    sourceTool: SourceTool,
    query: string,
    maxResults: number,
  ): Promise<SearchEvidence> {
    const controller = new AbortController()
    const deadline = this.#config.now() + this.#config.timeout_ms
    const timeout = setTimeout(() => {
      controller.abort()
    }, this.#config.timeout_ms)

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (this.#config.now() >= deadline) {
          throw new TavilySearchError('timeout')
        }

        const response = await this.#fetch(query, maxResults, controller.signal)
        if (response.status === 200) {
          const body = await this.#parseSuccess(response, controller.signal)
          return normalizeEvidence(
            body,
            sourceTool,
            query,
            maxResults,
            new Date(this.#config.now()).toISOString(),
          )
        }

        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), this.#config.now())
        const providerRequestId = responseRequestId(response, [this.#config.api_key, query])
        if (attempt === 0 && RETRYABLE_STATUS_CODES.has(response.status)) {
          const retryDelay = retryAfter ?? 0
          const remaining = deadline - this.#config.now()
          if (retryDelay < remaining) {
            if (retryDelay > 0) {
              await raceWithAbort(
                Promise.resolve().then(() => this.#config.sleep(retryDelay, controller.signal)),
                controller.signal,
              )
            }
            continue
          }
        }

        throw statusError(response.status, retryAfter, providerRequestId)
      }
      throw new TavilySearchError('upstream')
    } finally {
      clearTimeout(timeout)
    }
  }

  async #fetch(query: string, maxResults: number, signal: AbortSignal): Promise<Response> {
    const body = JSON.stringify({
      query,
      topic: 'general',
      search_depth: 'basic',
      auto_parameters: false,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
      include_usage: true,
      max_results: maxResults,
    })

    try {
      return await raceWithAbort(
        Promise.resolve().then(() =>
          this.#config.fetch(this.#config.search_url, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${this.#config.api_key}`,
              'Content-Type': 'application/json',
            },
            body,
            signal,
          }),
        ),
        signal,
      )
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof TavilySearchError && error.code === 'timeout')) {
        throw new TavilySearchError('timeout')
      }
      throw new TavilySearchError('network')
    }
  }

  async #parseSuccess(response: Response, signal: AbortSignal): Promise<TavilySearchSuccess> {
    let body: unknown
    try {
      body = await raceWithAbort(response.json(), signal)
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof TavilySearchError && error.code === 'timeout')) {
        throw new TavilySearchError('timeout')
      }
      throw new TavilySearchError('invalid_response')
    }

    const parsed = TavilySearchSuccessSchema.safeParse(body)
    if (!parsed.success) {
      throw new TavilySearchError('invalid_response')
    }
    return parsed.data
  }
}

export function createTavilySearchAdapter(config: TavilySearchAdapterConfig): TavilySearchAdapter {
  return new TavilySearchAdapterImplementation(config)
}

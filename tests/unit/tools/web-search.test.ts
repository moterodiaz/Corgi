import { afterEach, describe, expect, it, vi } from 'vitest'

import { TavilySearchError, createTavilySearchAdapter } from '../../../src/tools/web-search.js'

const API_KEY = 'tvly-test-super-secret'
const NOW = Date.parse('2026-07-25T19:30:00.000Z')
const VENUE_QUERY =
  'late night coffee venues in Oakland, CA, US; categories: bakery, cafe; cost tier: low'
const EVENT_QUERY =
  'live jazz events in Oakland, CA, US; event dates: 2026-08-01 through 2026-08-03; categories: jazz, music; cost tier: medium'

const venueInput = {
  query: 'late night coffee',
  locality: 'Oakland',
  region: 'CA',
  country: 'US',
  categories: ['cafe', 'bakery'],
  cost_tier: 'low' as const,
  max_results: 3,
}

const eventInput = {
  query: 'live jazz',
  locality: 'Oakland',
  region: 'CA',
  country: 'US',
  categories: ['music', 'jazz'],
  cost_tier: 'medium' as const,
  starts_on: '2026-08-01',
  ends_on: '2026-08-03',
  max_results: 4,
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  })
}

function tavilySuccess(
  options: {
    readonly query?: string
    readonly requestId?: string
    readonly credits?: number
    readonly title?: string
    readonly url?: string
    readonly content?: string
    readonly score?: number
  } = {},
): Response {
  return jsonResponse({
    query: options.query ?? VENUE_QUERY,
    response_time: '0.12',
    results: [
      {
        title: options.title ?? 'The New Parkway Theater',
        url: options.url ?? 'https://example.test/venues/the-new-parkway-theater',
        content: options.content ?? 'A neighborhood cinema and cafe with evening events.',
        score: options.score ?? 0.91,
      },
    ],
    request_id: options.requestId ?? 'req_venue',
    usage: {
      credits: options.credits ?? 1,
    },
  })
}

function createFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>()
}

function firstCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): Parameters<typeof fetch> {
  const call = fetchMock.mock.calls[0]
  if (call === undefined) {
    throw new Error('expected fetch to have been called at least once')
  }
  return call
}

function parseRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') {
    throw new TypeError('expected a JSON string request body')
  }
  return JSON.parse(init.body) as unknown
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected promise to reject')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Tavily web search adapter', () => {
  it('sends deterministic authorization, content headers, and venue request body', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(tavilySuccess())
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      now: () => NOW,
    })

    const result = await adapter.searchVenues(venueInput)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = firstCall(fetchMock)
    expect(url).toBe('https://api.tavily.com/search')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    })
    expect(init?.body).toBe(
      JSON.stringify({
        query: VENUE_QUERY,
        topic: 'general',
        search_depth: 'basic',
        auto_parameters: false,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_favicon: false,
        include_usage: true,
        max_results: 3,
      }),
    )
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(result).toEqual({
      provider: 'tavily',
      source_tool: 'search_venues',
      query: VENUE_QUERY,
      results: [
        {
          ref_id: 'tavily:req_venue:1',
          title: 'The New Parkway Theater',
          source_url: 'https://example.test/venues/the-new-parkway-theater',
          summary: 'A neighborhood cinema and cafe with evening events.',
          relevance_score: 0.91,
        },
      ],
      retrieved_at: '2026-07-25T19:30:00.000Z',
      provider_request_id: 'req_venue',
      credits_used: 1,
      cache_hit: false,
    })
  })

  it('constructs an event-occurrence query without misusing publication-date filters', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      tavilySuccess({
        query: EVENT_QUERY,
        requestId: 'req_event',
        title: 'Friday Night Jazz',
        url: 'https://example.test/events/friday-night-jazz',
        content: 'A live jazz performance on August 2.',
        score: 0.87,
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      now: () => NOW,
    })

    const result = await adapter.searchEvents(eventInput)

    const [, init] = firstCall(fetchMock)
    const body = parseRequestBody(init)
    expect(body).toEqual({
      query: EVENT_QUERY,
      topic: 'general',
      search_depth: 'basic',
      auto_parameters: false,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
      include_usage: true,
      max_results: 4,
    })
    expect(body).not.toHaveProperty('start_date')
    expect(body).not.toHaveProperty('end_date')
    expect(result).toMatchObject({
      source_tool: 'search_events',
      query: EVENT_QUERY,
      provider_request_id: 'req_event',
      results: [
        {
          ref_id: 'tavily:req_event:1',
          title: 'Friday Night Jazz',
          source_url: 'https://example.test/events/friday-night-jazz',
          summary: 'A live jazz performance on August 2.',
          relevance_score: 0.87,
        },
      ],
    })
  })

  it('uses deterministic defaults and canonicalizes whitespace and category order', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      tavilySuccess({
        query: 'tea venues in Berkeley; categories: bakery, tea',
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })

    await adapter.searchVenues({
      query: '  tea  ',
      locality: ' Berkeley ',
      categories: ['tea', 'bakery'],
    })

    const [, init] = firstCall(fetchMock)
    expect(parseRequestBody(init)).toEqual({
      query: 'tea venues in Berkeley; categories: bakery, tea',
      topic: 'general',
      search_depth: 'basic',
      auto_parameters: false,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
      include_usage: true,
      max_results: 5,
    })
  })

  it('rejects invalid venue inputs before calling fetch', async () => {
    const fetchMock = createFetchMock()
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })
    const invalidInputs: unknown[] = [
      { query: ' ', locality: 'Oakland' },
      { query: 'coffee', locality: ' ' },
      { query: 'coffee', locality: 'Oakland', max_results: 0 },
      {
        query: 'coffee',
        locality: 'Oakland',
        categories: ['one', 'two', 'three', 'four', 'five', 'six'],
      },
      { query: 'coffee', locality: 'Oakland', cost_tier: 'luxury' },
    ]

    for (const input of invalidInputs) {
      await expect(adapter.searchVenues(input as never)).rejects.toMatchObject({
        code: 'invalid_request',
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid event dates and reversed ranges before calling fetch', async () => {
    const fetchMock = createFetchMock()
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })

    await expect(
      adapter.searchEvents({
        ...eventInput,
        starts_on: 'August 1',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(
      adapter.searchEvents({
        ...eventInput,
        starts_on: '2026-08-04',
        ends_on: '2026-08-03',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a 400-character venue query and rejects 401 characters before fetch', async () => {
    const locality = 'l'.repeat(120)
    const exactInputQuery = 'q'.repeat(269)
    const exactComposedQuery = `${exactInputQuery} venues in ${locality}`
    expect(exactComposedQuery).toHaveLength(400)
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      tavilySuccess({
        query: exactComposedQuery,
        requestId: 'req_venue_boundary',
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })

    await expect(
      adapter.searchVenues({
        query: exactInputQuery,
        locality,
      }),
    ).resolves.toMatchObject({
      query: exactComposedQuery,
      provider_request_id: 'req_venue_boundary',
    })
    await expect(
      adapter.searchVenues({
        query: `${exactInputQuery}q`,
        locality,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts a 400-character event query and rejects 401 characters before fetch', async () => {
    const locality = 'l'.repeat(120)
    const eventSuffix = ` events in ${locality}` + '; event dates: 2026-08-01 through 2026-08-03'
    const exactInputQuery = 'q'.repeat(400 - eventSuffix.length)
    const exactComposedQuery = `${exactInputQuery}${eventSuffix}`
    expect(exactComposedQuery).toHaveLength(400)
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      tavilySuccess({
        query: exactComposedQuery,
        requestId: 'req_event_boundary',
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })
    const boundaryInput = {
      query: exactInputQuery,
      locality,
      starts_on: '2026-08-01',
      ends_on: '2026-08-03',
    }

    await expect(adapter.searchEvents(boundaryInput)).resolves.toMatchObject({
      query: exactComposedQuery,
      provider_request_id: 'req_event_boundary',
    })
    await expect(
      adapter.searchEvents({
        ...boundaryInput,
        query: `${exactInputQuery}q`,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a malformed success response without retrying', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: VENUE_QUERY,
        response_time: 0.12,
        results: [
          {
            title: 'Broken result',
            url: 'not-a-url',
            content: 'Missing a valid source URL.',
            score: 0.5,
          },
        ],
        request_id: 'req_malformed',
        usage: { credits: 1 },
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })
    const result = adapter.searchVenues(venueInput)

    await expect(result).rejects.toBeInstanceOf(TavilySearchError)
    await expect(result).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    'javascript:alert(document.domain)',
    'data:text/plain,not-a-web-result',
    'file:///etc/passwd',
    'ftp://example.test/result',
  ])('rejects an unsafe Tavily result URL scheme as invalid_response: %s', async (unsafeUrl) => {
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      tavilySuccess({
        url: unsafeUrl,
        requestId: 'req_unsafe_url',
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })

    await expect(adapter.searchVenues(venueInput)).rejects.toMatchObject({
      code: 'invalid_response',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an HTTP Tavily base URL before fetch can be called', () => {
    const fetchMock = createFetchMock()
    let error: unknown

    try {
      createTavilySearchAdapter({
        api_key: API_KEY,
        base_url: 'http://api.tavily.test',
        fetch: fetchMock,
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(TavilySearchError)
    expect(error).toMatchObject({ code: 'invalid_request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps 401 to a sanitized unauthorized error without retrying', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Invalid API key' }, 401, {
        'x-request-id': 'req_auth',
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })
    const error = await captureRejection(adapter.searchVenues(venueInput))

    expect(error).toBeInstanceOf(TavilySearchError)
    expect(error).toMatchObject({
      code: 'unauthorized',
      status: 401,
      retryable: false,
      provider_request_id: 'req_auth',
    })
    if (!(error instanceof TavilySearchError)) {
      throw new TypeError('expected TavilySearchError')
    }
    expect(error.toJSON()).toEqual({
      name: 'TavilySearchError',
      code: 'unauthorized',
      message: 'Tavily search authentication failed',
      status: 401,
      retryable: false,
      provider_request_id: 'req_auth',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('omits API-key-bearing request IDs and response details from JSON metadata', async () => {
    const privateQuery = 'private-birthday-surprise'
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: `${API_KEY}; query=${privateQuery}` }, 401, {
        'x-request-id': `req:${API_KEY}`,
      }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })

    const error = await captureRejection(
      adapter.searchVenues({
        query: privateQuery,
        locality: 'Oakland',
      }),
    )

    if (!(error instanceof TavilySearchError)) {
      throw new TypeError('expected TavilySearchError')
    }
    expect(error.provider_request_id).toBeUndefined()
    const json = error.toJSON()
    expect(json).toEqual({
      name: 'TavilySearchError',
      code: 'unauthorized',
      message: 'Tavily search authentication failed',
      status: 401,
      retryable: false,
    })
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain(API_KEY)
    expect(serialized).not.toContain(privateQuery)
  })

  it.each([432, 433])(
    'maps Tavily quota status %i to quota_exhausted without retrying',
    async (status) => {
      const fetchMock = createFetchMock()
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: 'Monthly credit limit reached' }, status, {
          'request-id': `req_quota_${String(status)}`,
        }),
      )
      const adapter = createTavilySearchAdapter({
        api_key: API_KEY,
        fetch: fetchMock,
      })
      const result = adapter.searchVenues(venueInput)

      await expect(result).rejects.toBeInstanceOf(TavilySearchError)
      await expect(result).rejects.toMatchObject({
        code: 'quota_exhausted',
        status,
        retryable: false,
        provider_request_id: `req_quota_${String(status)}`,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('honors Retry-After once for 429 and then returns the successful retry', async () => {
    const fetchMock = createFetchMock()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Too many requests' }, 429, {
          'retry-after': '1',
        }),
      )
      .mockResolvedValueOnce(tavilySuccess({ requestId: 'req_retry' }))
    const sleep = vi.fn(() => Promise.resolve())
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      now: () => NOW,
      sleep,
    })

    const result = await adapter.searchVenues(venueInput)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(1_000, expect.any(AbortSignal))
    expect(result).toMatchObject({
      provider_request_id: 'req_retry',
      cache_hit: false,
    })
  })

  it('stops after one retry when a retryable response keeps failing', async () => {
    const fetchMock = createFetchMock()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Too many requests' }, 429))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Still too many requests' }, 429, {
          'retry-after': '2',
          'tavily-request-id': 'req_rate_limit',
        }),
      )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      sleep: vi.fn(() => Promise.resolve()),
    })
    const result = adapter.searchVenues(venueInput)

    await expect(result).rejects.toBeInstanceOf(TavilySearchError)
    await expect(result).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryable: true,
      retry_after_ms: 2_000,
      provider_request_id: 'req_rate_limit',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries HTTP 500 once and returns a successful second response', async () => {
    const fetchMock = createFetchMock()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Internal server error' }, 500))
      .mockResolvedValueOnce(tavilySuccess({ requestId: 'req_after_internal_error' }))
    const sleep = vi.fn(() => Promise.resolve())
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      sleep,
    })

    await expect(adapter.searchVenues(venueInput)).resolves.toMatchObject({
      provider_request_id: 'req_after_internal_error',
      cache_hit: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('reports retryable HTTP 500 metadata after retry exhaustion', async () => {
    const fetchMock = createFetchMock()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Internal server error' }, 500))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Still unavailable' }, 500, {
          'retry-after': '3',
          'x-request-id': 'req_internal_error',
        }),
      )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      sleep: vi.fn(() => Promise.resolve()),
    })

    await expect(adapter.searchVenues(venueInput)).rejects.toMatchObject({
      code: 'upstream',
      status: 500,
      retryable: true,
      retry_after_ms: 3_000,
      provider_request_id: 'req_internal_error',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('times out an in-flight fetch and does not retry it', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted === true) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      timeout_ms: 25,
    })
    const result = captureRejection(adapter.searchVenues(venueInput))

    await vi.advanceTimersByTimeAsync(26)

    const error = await result
    expect(error).toBeInstanceOf(TavilySearchError)
    expect(error).toMatchObject({ code: 'timeout' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a zero-credit cache hit for a canonically equivalent venue input', async () => {
    const fetchMock = createFetchMock()
    fetchMock.mockResolvedValueOnce(tavilySuccess())
    let now = NOW
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      now: () => now,
    })

    const first = await adapter.searchVenues(venueInput)
    now += 60_000
    const second = await adapter.searchVenues({
      ...venueInput,
      query: ' late night coffee ',
      locality: ' Oakland ',
      categories: ['bakery', 'cafe'],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({ cache_hit: false, credits_used: 1 })
    expect(second).toEqual({
      ...first,
      cache_hit: true,
      credits_used: 0,
    })
  })

  it.each([
    {
      name: 'venue',
      ttlMs: 21_600_000,
      search: 'venue' as const,
    },
    {
      name: 'event',
      ttlMs: 900_000,
      search: 'event' as const,
    },
  ])('expires the $name success cache at its documented TTL', async (testCase) => {
    const firstQuery = testCase.search === 'venue' ? VENUE_QUERY : EVENT_QUERY
    const fetchMock = createFetchMock()
    fetchMock
      .mockResolvedValueOnce(tavilySuccess({ query: firstQuery, requestId: 'req_first' }))
      .mockResolvedValueOnce(tavilySuccess({ query: firstQuery, requestId: 'req_after_expiry' }))
    let now = NOW
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      now: () => now,
    })
    const search = () =>
      testCase.search === 'venue'
        ? adapter.searchVenues(venueInput)
        : adapter.searchEvents(eventInput)

    await search()
    now += testCase.ttlMs - 1
    const cached = await search()
    now += 1
    const refreshed = await search()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cached).toMatchObject({
      provider_request_id: 'req_first',
      cache_hit: true,
      credits_used: 0,
    })
    expect(refreshed).toMatchObject({
      provider_request_id: 'req_after_expiry',
      cache_hit: false,
      credits_used: 1,
    })
  })

  it('deduplicates concurrent identical searches into one in-flight request', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
      now: () => NOW,
    })

    const first = adapter.searchVenues(venueInput)
    const second = adapter.searchVenues({
      ...venueInput,
      categories: ['bakery', 'cafe'],
    })

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch?.(tavilySuccess({ requestId: 'req_deduplicated' }))
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(firstResult).toEqual(secondResult)
    expect(firstResult).toMatchObject({
      provider_request_id: 'req_deduplicated',
      cache_hit: false,
      credits_used: 1,
    })
  })

  it('redacts the API key and request data from translated fetch failures', async () => {
    const privateQuery = 'private birthday surprise'
    const fetchMock = createFetchMock()
    fetchMock.mockRejectedValueOnce(
      new Error(`request failed with Authorization: Bearer ${API_KEY}; query=${privateQuery}`),
    )
    const adapter = createTavilySearchAdapter({
      api_key: API_KEY,
      fetch: fetchMock,
    })

    const error = await captureRejection(
      adapter.searchVenues({
        query: privateQuery,
        locality: 'Oakland',
      }),
    )

    expect(error).toBeInstanceOf(TavilySearchError)
    expect(error).toMatchObject({ code: 'network' })
    if (!(error instanceof TavilySearchError)) {
      throw new TypeError('expected a translated TavilySearchError')
    }
    const cause: unknown = error.cause
    expect(cause).toBeUndefined()
    expect(error.toJSON()).toEqual({
      name: 'TavilySearchError',
      code: 'network',
      message: 'Tavily search network request failed',
    })
    const diagnostic = [String(error), error.message, JSON.stringify(error.toJSON())].join('\n')
    expect(diagnostic).not.toContain(API_KEY)
    expect(diagnostic).not.toContain(privateQuery)
  })
})

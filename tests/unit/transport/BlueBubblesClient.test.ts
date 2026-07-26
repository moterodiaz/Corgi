import { describe, expect, it, vi } from 'vitest'

import {
  BlueBubblesError,
  createBlueBubblesClient,
} from '../../../src/transport/BlueBubblesClient.js'

/** Builds a Response-like object exposing only what BlueBubblesClient reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

/** A response whose body cannot be parsed as JSON (simulates a truncated/garbled reply). */
function unparsableResponse(status: number): Response {
  return {
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
  } as unknown as Response
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Awaits a promise expected to reject and returns the thrown error, or fails the test. */
async function captureRejection(promise: Promise<unknown>): Promise<BlueBubblesError> {
  try {
    await promise
  } catch (error) {
    return error as BlueBubblesError
  }
  throw new Error('expected promise to reject, but it resolved')
}

describe('createBlueBubblesClient / sendText', () => {
  it('POSTs to /api/v1/message/text with the password in the query string, JSON headers, and a generated tempGuid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 200,
        message: 'Message sent!',
        data: { guid: 'msg-guid-1', dateCreated: 1_720_000_000_000 },
      }),
    )

    const client = createBlueBubblesClient({
      server_url: 'http://127.0.0.1:1234',
      password: 'super-secret-pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.sendText({
      chatGuid: 'iMessage;-;+15551234567',
      message: 'hello there',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [URL, RequestInit]

    expect(calledUrl).toBeInstanceOf(URL)
    expect(calledUrl.toString()).toBe(
      'http://127.0.0.1:1234/api/v1/message/text?password=super-secret-pw',
    )
    expect(calledInit.method).toBe('POST')
    expect(calledInit.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(calledInit.redirect).toBe('manual')

    const parsedBody = JSON.parse(calledInit.body as string) as Record<string, unknown>
    expect(parsedBody['chatGuid']).toBe('iMessage;-;+15551234567')
    expect(parsedBody['message']).toBe('hello there')
    expect(Object.hasOwn(parsedBody, 'selectedMessageGuid')).toBe(false)
    expect(typeof parsedBody['tempGuid']).toBe('string')
    expect(parsedBody['tempGuid'] as string).toMatch(UUID_V4_PATTERN)

    expect(result).toEqual({ guid: 'msg-guid-1', dateCreated: new Date(1_720_000_000_000) })
  })

  it('generates a fresh tempGuid per call rather than reusing one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 200,
        message: 'ok',
        data: { guid: 'g', dateCreated: 1 },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:9999',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await client.sendText({ chatGuid: 'c', message: 'one' })
    await client.sendText({ chatGuid: 'c', message: 'two' })

    const [, firstInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const [, secondInit] = fetchMock.mock.calls[1] as [URL, RequestInit]
    const firstTempGuid = (JSON.parse(firstInit.body as string) as Record<string, unknown>)[
      'tempGuid'
    ]
    const secondTempGuid = (JSON.parse(secondInit.body as string) as Record<string, unknown>)[
      'tempGuid'
    ]

    expect(firstTempGuid).not.toBe(secondTempGuid)
  })

  it('includes selectedMessageGuid in the body only when it is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 200,
        message: 'ok',
        data: { guid: 'g2', dateCreated: 1 },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:9999',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await client.sendText({
      chatGuid: 'chat-1',
      message: 'reply',
      selectedMessageGuid: 'orig-guid-123',
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['selectedMessageGuid']).toBe('orig-guid-123')
  })

  it('strips a trailing slash on server_url so the path never contains a double slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 200,
        message: 'ok',
        data: { guid: 'g', dateCreated: 1 },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234/',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await client.sendText({ chatGuid: 'c', message: 'm' })

    const [calledUrl] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(calledUrl.toString()).toBe('http://localhost:1234/api/v1/message/text?password=pw')
  })

  it('maps a 401 response to an unauthorized error without ever parsing the body', async () => {
    const jsonSpy = vi.fn().mockRejectedValue(new Error('json() should not be called on a 401'))
    const fetchMock = vi.fn().mockResolvedValue({ status: 401, json: jsonSpy })
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('unauthorized')
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it("maps a non-2xx response with a validation-error envelope to invalid_request, preserving the server's message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        status: 400,
        message: 'Bad request',
        error: { type: 'ValidationError', message: 'chatGuid is required' },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: '', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('invalid_request')
    expect(error.message).toBe('chatGuid is required')
  })

  it('maps a non-2xx response with a recognized-but-non-validation error type to upstream_error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(500, {
        status: 500,
        message: 'boom',
        error: { type: 'ServerError', message: 'db unavailable' },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('upstream_error')
  })

  it("maps a non-2xx response whose body doesn't match the error envelope shape to upstream_error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { status: 500, message: 'Internal Server Error' }))
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('upstream_error')
  })

  it('maps an unparseable JSON body on an otherwise-2xx response to upstream_error instead of throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(unparsableResponse(200))
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('upstream_error')
  })

  it("maps a 2xx body that doesn't match the success envelope shape to upstream_error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }))
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('upstream_error')
  })

  it('maps a 2xx success envelope whose data fails validation to upstream_error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 200,
        message: 'Message sent!',
        data: { guid: '', dateCreated: 'not-a-number' },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('upstream_error')
  })

  it('maps a network failure (fetch rejects) to upstream_error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('upstream_error')
  })

  it('maps the internal timeout guard aborting the request to a timeout error, not upstream_error', async () => {
    vi.useFakeTimers()
    try {
      // Emulates real fetch's abort behavior: the returned promise only
      // settles (by rejecting) once the passed-in AbortSignal fires.
      const fetchMock = vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const abortError = new Error('The operation was aborted.')
              abortError.name = 'AbortError'
              reject(abortError)
            })
          }),
      )

      const client = createBlueBubblesClient({
        server_url: 'http://localhost:1234',
        password: 'pw',
        timeout_ms: 5_000,
        fetch: fetchMock as unknown as typeof fetch,
      })

      let settledError: BlueBubblesError | undefined
      const pending = client.sendText({ chatGuid: 'c', message: 'm' })
      pending.catch((error: unknown) => {
        settledError = error as BlueBubblesError
      })

      // Not yet at the configured timeout: must still be pending.
      await vi.advanceTimersByTimeAsync(4_999)
      expect(settledError).toBeUndefined()

      // Crossing the configured timeout fires the abort, which rejects fetch.
      await vi.advanceTimersByTimeAsync(1)

      expect(settledError).toBeInstanceOf(BlueBubblesError)
      expect(settledError?.code).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to observed-now when the server omits dateCreated (a real, documented null case)', async () => {
    const before = Date.now()
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: 200,
        message: 'Message sent!',
        data: { guid: 'msg-guid-null-date', dateCreated: null },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await client.sendText({ chatGuid: 'c', message: 'm' })
    const after = Date.now()

    expect(result.guid).toBe('msg-guid-null-date')
    expect(result.dateCreated.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.dateCreated.getTime()).toBeLessThanOrEqual(after)
  })

  it('keeps the timeout armed through a slow response body, not just until headers arrive', async () => {
    vi.useFakeTimers()
    try {
      // fetch() itself resolves quickly (headers arrived), but response.json()
      // never settles on its own — only the abort signal makes it reject.
      const fetchMock = vi.fn((_url: URL, init: RequestInit) =>
        Promise.resolve({
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                const abortError = new Error('The operation was aborted.')
                abortError.name = 'AbortError'
                reject(abortError)
              })
            }),
        } as unknown as Response),
      )

      const client = createBlueBubblesClient({
        server_url: 'http://localhost:1234',
        password: 'pw',
        timeout_ms: 5_000,
        fetch: fetchMock as unknown as typeof fetch,
      })

      let settledError: BlueBubblesError | undefined
      const pending = client.sendText({ chatGuid: 'c', message: 'm' })
      pending.catch((error: unknown) => {
        settledError = error as BlueBubblesError
      })

      // fetch() itself has resolved by now (headers "arrived" synchronously
      // in this mock) — the old code cleared the timer right here.
      await vi.advanceTimersByTimeAsync(0)
      expect(settledError).toBeUndefined()

      await vi.advanceTimersByTimeAsync(4_999)
      expect(settledError).toBeUndefined()

      await vi.advanceTimersByTimeAsync(1)
      expect(settledError).toBeInstanceOf(BlueBubblesError)
      expect(settledError?.code).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('distinguishes a caller-supplied signal abort from its own internal timeout', async () => {
    const fetchMock = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted.')
            abortError.name = 'AbortError'
            reject(abortError)
          })
        }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      timeout_ms: 60_000,
      fetch: fetchMock as unknown as typeof fetch,
    })
    const controller = new AbortController()

    const pending = client.sendText({ chatGuid: 'c', message: 'm' }, controller.signal)
    controller.abort()
    const error = await captureRejection(pending)

    expect(error.code).toBe('aborted')
  })

  it('always sets redirect: manual, and treats a 3xx response as a failure rather than following it with the password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(302, {
        status: 302,
        message: 'Found',
        error: { type: 'RedirectError', message: 'unexpected redirect' },
      }),
    )
    const client = createBlueBubblesClient({
      server_url: 'http://localhost:1234',
      password: 'pw',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const error = await captureRejection(client.sendText({ chatGuid: 'c', message: 'm' }))

    expect(error).toBeInstanceOf(BlueBubblesError)
    expect(error.code).toBe('upstream_error')

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(init.redirect).toBe('manual')
  })
})

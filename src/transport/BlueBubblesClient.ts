import { z } from 'zod'

// BlueBubbles Server — self-hosted, local. Verified 2026-07-26 against
// docs.bluebubbles.app and the bluebubbles-server source
// (BlueBubblesApp/bluebubbles-server, packages/server/src/server/api/http).
export const DEFAULT_BLUEBUBBLES_TIMEOUT_MS = 15_000

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//iu.test(value), {
    message: 'URL must use HTTP or HTTPS',
  })

export type BlueBubblesErrorCode =
  'invalid_request' | 'unauthorized' | 'upstream_error' | 'timeout' | 'aborted'

export class BlueBubblesError extends Error {
  readonly code: BlueBubblesErrorCode

  constructor(code: BlueBubblesErrorCode, message?: string) {
    super(message ?? `BlueBubbles request failed: ${code}`)
    this.name = 'BlueBubblesError'
    this.code = code
  }
}

// Envelope shape verified 2026-07-26 directly against the server source
// (packages/server/src/server/api/http/api/v1/responses/{types,errors,index}.ts,
// errorMiddleware.ts), which is the wire ground truth — the published docs
// page (developer-guides/rest-api-and-webhooks) is stale and says
// `error: { type, error }`; the real field is `error: { type, message }`.
const SuccessEnvelopeSchema = z
  .object({
    status: z.number(),
    message: z.string(),
    data: z.unknown(),
  })
  .passthrough()

const ErrorEnvelopeSchema = z
  .object({
    status: z.number(),
    message: z.string(),
    error: z.object({ type: z.string(), message: z.string() }).passthrough(),
  })
  .passthrough()

// A message send's `data` — only the fields this client actually reads are
// validated; BlueBubbles' serialized Message object has many more (verified
// against MessageSerializer.ts) that this client intentionally ignores.
// dateCreated is nullable: MessageSerializer.ts emits
// `message.dateCreated ? message.dateCreated.getTime() : null`, and the
// underlying chat.db date column can genuinely be absent/zero.
const SentMessageDataSchema = z.object({
  guid: z.string().min(1),
  dateCreated: z.number().nullable(),
})

export interface BlueBubblesClientConfig {
  server_url: string
  password: string
  timeout_ms?: number
  fetch?: typeof globalThis.fetch
}

export interface SendTextInput {
  chatGuid: string
  message: string
  // Reply-threads under a prior message. Requires Private API — per docs,
  // supplying this auto-upgrades the send method server-side. Omit entirely
  // when Private API isn't enabled; do not pass method: 'private-api'
  // yourself without it being actually configured on the server.
  selectedMessageGuid?: string
}

export interface SentMessage {
  guid: string
  dateCreated: Date
}

const SendTextConfigSchema = z
  .object({
    server_url: HttpUrlSchema,
    password: z.string().min(1),
    timeout_ms: z.number().int().min(1).max(120_000).default(DEFAULT_BLUEBUBBLES_TIMEOUT_MS),
    fetch: z
      .custom<typeof globalThis.fetch>((value: unknown) => typeof value === 'function')
      .optional(),
  })
  .strict()

export interface BlueBubblesClient {
  sendText(input: SendTextInput, signal?: AbortSignal): Promise<SentMessage>
}

export function createBlueBubblesClient(config: BlueBubblesClientConfig): BlueBubblesClient {
  const parsed = SendTextConfigSchema.parse(config)
  const fetchImpl = parsed.fetch ?? globalThis.fetch
  const baseUrl = parsed.server_url.replace(/\/+$/, '')

  return {
    async sendText(input: SendTextInput, signal?: AbortSignal): Promise<SentMessage> {
      const url = new URL(`${baseUrl}/api/v1/message/text`)
      url.searchParams.set('password', parsed.password)

      const controller = new AbortController()
      // Distinguishes "our own deadline fired" from "the caller cancelled"
      // so both don't collapse into the same ambiguous error code.
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, parsed.timeout_ms)
      const forwardAbort = (): void => {
        controller.abort()
      }
      if (signal?.aborted === true) {
        forwardAbort()
      } else {
        signal?.addEventListener('abort', forwardAbort, { once: true })
      }

      let response: Response
      let body: unknown
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatGuid: input.chatGuid,
            // Required by the server when using apple-script (the default
            // send method) — used server-side for send-dedup.
            tempGuid: crypto.randomUUID(),
            message: input.message,
            ...(input.selectedMessageGuid === undefined
              ? {}
              : { selectedMessageGuid: input.selectedMessageGuid }),
          }),
          // Never follow a redirect on a request carrying the server
          // password in its query string.
          redirect: 'manual',
          signal: controller.signal,
        })
        if (response.status === 401) {
          throw new BlueBubblesError('unauthorized')
        }
        // Kept inside the same try/finally as fetch() itself — the deadline
        // must cover a slow/stalled response body, not just headers arriving.
        body = await response.json()
      } catch (error) {
        if (error instanceof BlueBubblesError) {
          throw error
        }
        if (timedOut) {
          throw new BlueBubblesError('timeout')
        }
        if (signal?.aborted === true) {
          throw new BlueBubblesError('aborted')
        }
        throw new BlueBubblesError('upstream_error')
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', forwardAbort)
      }

      if (response.status < 200 || response.status >= 300) {
        const errorEnvelope = ErrorEnvelopeSchema.safeParse(body)
        if (
          errorEnvelope.success &&
          errorEnvelope.data.error.type.toLowerCase().includes('valid')
        ) {
          throw new BlueBubblesError('invalid_request', errorEnvelope.data.error.message)
        }
        throw new BlueBubblesError('upstream_error')
      }

      const envelope = SuccessEnvelopeSchema.safeParse(body)
      if (!envelope.success) {
        throw new BlueBubblesError('upstream_error')
      }
      const data = SentMessageDataSchema.safeParse(envelope.data.data)
      if (!data.success) {
        throw new BlueBubblesError('upstream_error')
      }
      return {
        guid: data.data.guid,
        // The server can legitimately omit the timestamp (see schema
        // comment above) — fall back to observed-now rather than failing
        // a send that actually succeeded.
        dateCreated: data.data.dateCreated === null ? new Date() : new Date(data.data.dateCreated),
      }
    },
  }
}

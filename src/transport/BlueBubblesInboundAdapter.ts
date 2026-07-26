import { io, type Socket } from 'socket.io-client'
import { z } from 'zod'
import {
  type CardInteractionAction,
  type TransportCardInteraction,
  type TransportInboundMessage,
  type Unsubscribe,
} from './TransportPort.js'

// Verified 2026-07-26 against BlueBubblesApp/bluebubbles-server source
// (server/events.ts NEW_MESSAGE constant, server/index.ts emitMessage): the
// Socket.IO event is literally 'new-message' and its payload is the
// serialized Message object directly — the same shape used for both the
// socket push and the webhook POST body's `data` field. There is no
// separate reaction/tapback event; a tapback is a regular new-message
// row with `associatedMessageType` set (server/api/apple/mappings.ts).
export const NEW_MESSAGE_EVENT = 'new-message'

// 'love'|'like'|'laugh'|'emphasize' read as a positive/accept signal,
// 'dislike' as a veto, 'question' as "suggest something else" — an
// intentionally coarse mapping for the MVP feedback loop; anything more
// nuanced belongs in the chat-text feedback/diff layer, not here.
const REACTION_TYPE_TO_ACTION: Readonly<Record<string, CardInteractionAction>> = {
  love: 'accept',
  like: 'accept',
  laugh: 'accept',
  emphasize: 'accept',
  dislike: 'veto',
  question: 'suggest-alternative',
}

function reactionAction(associatedMessageType: string): CardInteractionAction | undefined {
  // Plain-object index without a hasOwn guard would resolve inherited
  // Object.prototype keys ('__proto__', 'constructor', 'toString', ...) to a
  // non-undefined value for attacker/data-controlled input, bypassing the
  // caller's `=== undefined` ignore-check.
  if (!Object.hasOwn(REACTION_TYPE_TO_ACTION, associatedMessageType)) {
    return undefined
  }
  return REACTION_TYPE_TO_ACTION[associatedMessageType]
}

// dateCreated is nullable: MessageSerializer.ts emits
// `message.dateCreated ? message.dateCreated.getTime() : null` for both the
// socket push and the webhook body — the same real edge case as
// BlueBubblesClient.ts's SentMessageDataSchema.
const BlueBubblesMessagePayloadSchema = z
  .object({
    guid: z.string().min(1),
    text: z.string().nullable().optional(),
    isFromMe: z.boolean(),
    handle: z
      .object({ address: z.string().min(1) })
      .passthrough()
      .nullable()
      .optional(),
    chats: z.array(z.object({ guid: z.string().min(1) }).passthrough()).min(1),
    dateCreated: z.number().nullable(),
    associatedMessageType: z.string().nullable().optional(),
  })
  .passthrough()

export type BlueBubblesMessagePayload = z.infer<typeof BlueBubblesMessagePayloadSchema>

export type MappedInboundEvent =
  | { kind: 'message'; message: TransportInboundMessage }
  | { kind: 'interaction'; interaction: TransportCardInteraction }
  | { kind: 'ignored'; reason: string }

// Pure and directly testable — the only thing that varies per real-vs-fake
// transport is how this function's input arrives (socket push vs. a test
// fixture), not the decision logic itself.
export function mapInboundPayload(raw: unknown): MappedInboundEvent {
  const parsed = BlueBubblesMessagePayloadSchema.safeParse(raw)
  if (!parsed.success) {
    return { kind: 'ignored', reason: 'malformed payload' }
  }
  const payload = parsed.data

  if (payload.isFromMe) {
    return { kind: 'ignored', reason: 'self-sent message' }
  }

  const chatGuid = payload.chats[0]?.guid
  if (chatGuid === undefined) {
    return { kind: 'ignored', reason: 'no associated chat' }
  }
  const senderId = payload.handle?.address ?? 'unknown'
  // The server can legitimately omit the timestamp (see schema comment
  // above) — fall back to observed-now rather than dropping a real message.
  const receivedAt = payload.dateCreated === null ? new Date() : new Date(payload.dateCreated)

  if (payload.associatedMessageType !== null && payload.associatedMessageType !== undefined) {
    // A leading '-' marks a removed reaction (e.g. '-love') — retractions
    // aren't acted on for the MVP feedback loop, only additions.
    const action = reactionAction(payload.associatedMessageType)
    if (action === undefined) {
      return {
        kind: 'ignored',
        reason: `unhandled or removed reaction: ${payload.associatedMessageType}`,
      }
    }
    return {
      kind: 'interaction',
      interaction: {
        interactionId: payload.guid,
        groupId: chatGuid,
        senderId,
        action,
        receivedAt,
      },
    }
  }

  if (payload.text === null || payload.text === undefined || payload.text.trim() === '') {
    return { kind: 'ignored', reason: 'no text content (attachment-only or system item)' }
  }

  return {
    kind: 'message',
    message: {
      messageId: payload.guid,
      groupId: chatGuid,
      senderId,
      text: payload.text,
      receivedAt,
    },
  }
}

export interface ConnectionIssue {
  type: 'connect_error' | 'disconnect' | 'handler_error'
  detail: unknown
}

export interface BlueBubblesInboundAdapterOptions {
  server_url: string
  password: string
  // Injectable for tests — defaults to the real socket.io-client factory.
  connect?: typeof io
  // Called on 'connect_error'/'disconnect' so a dead inbound channel is
  // never silent — defaults to logging, since socket.io-client's own
  // automatic reconnection means there's often no exception to catch and
  // no other signal that inbound messages have stopped flowing.
  onConnectionIssue?: (issue: ConnectionIssue) => void
}

const defaultOnConnectionIssue = (issue: ConnectionIssue): void => {
  console.error(`[BlueBubblesInboundAdapter] ${issue.type}:`, issue.detail)
}

export class BlueBubblesInboundAdapter {
  private readonly serverUrl: string
  private readonly password: string
  private readonly connectFn: typeof io
  private readonly onConnectionIssue: (issue: ConnectionIssue) => void
  private socket: Socket | undefined
  // Serializes dispatch of successive socket events so a slow handler for
  // an earlier message can't let a later message's handlers run/complete
  // first — without this, each 'new-message' event spawned its own
  // independent async chain with no ordering guarantee between them.
  private dispatchQueue: Promise<void> = Promise.resolve()

  private messageHandlers: Array<(message: TransportInboundMessage) => Promise<void> | void> = []
  private cardInteractionHandlers: Array<
    (interaction: TransportCardInteraction) => Promise<void> | void
  > = []

  constructor(options: BlueBubblesInboundAdapterOptions) {
    this.serverUrl = options.server_url
    this.password = options.password
    this.connectFn = options.connect ?? io
    this.onConnectionIssue = options.onConnectionIssue ?? defaultOnConnectionIssue
  }

  onMessage(handler: (message: TransportInboundMessage) => Promise<void> | void): Unsubscribe {
    this.messageHandlers.push(handler)
    return () => {
      this.messageHandlers = this.messageHandlers.filter((fn) => fn !== handler)
    }
  }

  onCardInteraction(
    handler: (interaction: TransportCardInteraction) => Promise<void> | void,
  ): Unsubscribe {
    this.cardInteractionHandlers.push(handler)
    return () => {
      this.cardInteractionHandlers = this.cardInteractionHandlers.filter((fn) => fn !== handler)
    }
  }

  connect(): void {
    if (this.socket !== undefined) {
      return
    }
    // Password sent as a socket.io handshake query param. Verified
    // 2026-07-26: the server's Socket.IO connection handler
    // (server/api/http/index.ts) checks
    // `socket.handshake.query?.password ?? socket.handshake.query?.guid`
    // — narrower than the REST AuthMiddleware's `guid ?? password ?? token`
    // (no `token` fallback on the socket path). Only `password` is sent
    // here, which both paths accept.
    this.socket = this.connectFn(this.serverUrl, { query: { password: this.password } })
    this.socket.on(NEW_MESSAGE_EVENT, (raw: unknown) => {
      this.dispatchQueue = this.dispatchQueue.then(() => this.dispatch(raw))
    })
    this.socket.on('connect_error', (error: unknown) => {
      this.onConnectionIssue({ type: 'connect_error', detail: error })
    })
    this.socket.on('disconnect', (reason: unknown) => {
      this.onConnectionIssue({ type: 'disconnect', detail: reason })
    })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = undefined
  }

  private async dispatch(raw: unknown): Promise<void> {
    const mapped = mapInboundPayload(raw)

    if (mapped.kind === 'message') {
      for (const handler of [...this.messageHandlers]) {
        await this.runHandler(() => handler(mapped.message))
      }
      return
    }

    if (mapped.kind === 'interaction') {
      for (const handler of [...this.cardInteractionHandlers]) {
        await this.runHandler(() => handler(mapped.interaction))
      }
    }
  }

  // A handler that throws or rejects must not crash the process (the
  // socket listener that triggers dispatch() is a detached callback with no
  // caller to catch it) or block every handler registered after it for the
  // same event.
  private async runHandler(run: () => Promise<void> | void): Promise<void> {
    try {
      await run()
    } catch (error) {
      this.onConnectionIssue({ type: 'handler_error', detail: error })
    }
  }
}

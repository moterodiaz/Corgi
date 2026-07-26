import { describe, expect, it, vi } from 'vitest'

import {
  BlueBubblesInboundAdapter,
  type BlueBubblesInboundAdapterOptions,
  NEW_MESSAGE_EVENT,
  mapInboundPayload,
} from '../../../src/transport/BlueBubblesInboundAdapter.js'
import type {
  TransportCardInteraction,
  TransportInboundMessage,
} from '../../../src/transport/TransportPort.js'

// A fixed epoch so every fixture produces a deterministic `receivedAt`.
const DATE_CREATED_MS = 1_753_481_234_567
const RECEIVED_AT = new Date(DATE_CREATED_MS)

// Base fixture matching BlueBubblesMessagePayloadSchema -- individual tests
// override only the fields they care about via `overrides`.
function makePayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    guid: 'msg-1',
    text: 'hello there',
    isFromMe: false,
    handle: { address: '+15551234567' },
    chats: [{ guid: 'chat-guid-1' }],
    dateCreated: DATE_CREATED_MS,
    associatedMessageType: null,
    ...overrides,
  }
}

describe('mapInboundPayload', () => {
  it('maps a normal inbound text message to a message event', () => {
    const result = mapInboundPayload(makePayload())

    expect(result).toEqual({
      kind: 'message',
      message: {
        messageId: 'msg-1',
        groupId: 'chat-guid-1',
        senderId: '+15551234567',
        text: 'hello there',
        receivedAt: RECEIVED_AT,
      },
    })
  })

  it('ignores a self-sent message (isFromMe: true)', () => {
    const result = mapInboundPayload(makePayload({ isFromMe: true }))

    expect(result).toEqual({ kind: 'ignored', reason: 'self-sent message' })
  })

  const REACTION_CASES: ReadonlyArray<{
    type: string
    action: 'accept' | 'veto' | 'suggest-alternative'
  }> = [
    { type: 'love', action: 'accept' },
    { type: 'like', action: 'accept' },
    { type: 'laugh', action: 'accept' },
    { type: 'emphasize', action: 'accept' },
    { type: 'dislike', action: 'veto' },
    { type: 'question', action: 'suggest-alternative' },
  ]

  it.each(REACTION_CASES)(
    'maps a "$type" tapback to a(n) "$action" interaction',
    ({ type, action }) => {
      // Tapback rows typically carry no text of their own.
      const payload = makePayload({
        guid: `reaction-${type}`,
        text: null,
        associatedMessageType: type,
      })

      const result = mapInboundPayload(payload)

      expect(result).toEqual({
        kind: 'interaction',
        interaction: {
          interactionId: `reaction-${type}`,
          groupId: 'chat-guid-1',
          senderId: '+15551234567',
          action,
          receivedAt: RECEIVED_AT,
        },
      })
    },
  )

  it('ignores a removed reaction (leading "-") instead of treating it as an addition', () => {
    const result = mapInboundPayload(makePayload({ text: null, associatedMessageType: '-love' }))

    expect(result).toEqual({
      kind: 'ignored',
      reason: 'unhandled or removed reaction: -love',
    })
  })

  it('ignores an unrecognized associatedMessageType value', () => {
    const result = mapInboundPayload(makePayload({ text: null, associatedMessageType: 'sticker' }))

    expect(result).toEqual({
      kind: 'ignored',
      reason: 'unhandled or removed reaction: sticker',
    })
  })

  it('ignores a message with null text and no associatedMessageType (attachment-only)', () => {
    const result = mapInboundPayload(makePayload({ text: null }))

    expect(result).toEqual({
      kind: 'ignored',
      reason: 'no text content (attachment-only or system item)',
    })
  })

  it('ignores a message with empty/whitespace-only text', () => {
    expect(mapInboundPayload(makePayload({ text: '' }))).toEqual({
      kind: 'ignored',
      reason: 'no text content (attachment-only or system item)',
    })
    expect(mapInboundPayload(makePayload({ text: '   ' }))).toEqual({
      kind: 'ignored',
      reason: 'no text content (attachment-only or system item)',
    })
  })

  describe('malformed payloads', () => {
    it('ignores a payload missing guid', () => {
      const payload = makePayload() as Record<string, unknown>
      delete payload.guid

      expect(mapInboundPayload(payload)).toEqual({ kind: 'ignored', reason: 'malformed payload' })
    })

    it('ignores a payload missing chats entirely', () => {
      const payload = makePayload() as Record<string, unknown>
      delete payload.chats

      expect(mapInboundPayload(payload)).toEqual({ kind: 'ignored', reason: 'malformed payload' })
    })

    it('ignores a payload with an empty chats array', () => {
      expect(mapInboundPayload(makePayload({ chats: [] }))).toEqual({
        kind: 'ignored',
        reason: 'malformed payload',
      })
    })

    it('ignores a payload with a non-boolean isFromMe', () => {
      expect(mapInboundPayload(makePayload({ isFromMe: 'false' }))).toEqual({
        kind: 'ignored',
        reason: 'malformed payload',
      })
    })

    it('ignores non-object input outright rather than throwing', () => {
      expect(() => mapInboundPayload(null)).not.toThrow()
      expect(mapInboundPayload(null)).toEqual({ kind: 'ignored', reason: 'malformed payload' })
      expect(mapInboundPayload('not an object')).toEqual({
        kind: 'ignored',
        reason: 'malformed payload',
      })
      expect(mapInboundPayload(undefined)).toEqual({ kind: 'ignored', reason: 'malformed payload' })
    })
  })

  it('falls back to senderId "unknown" when handle is null instead of crashing', () => {
    const result = mapInboundPayload(makePayload({ handle: null }))

    expect(result).toEqual({
      kind: 'message',
      message: {
        messageId: 'msg-1',
        groupId: 'chat-guid-1',
        senderId: 'unknown',
        text: 'hello there',
        receivedAt: RECEIVED_AT,
      },
    })
  })

  it('falls back to observed-now (not "malformed payload") when the server omits dateCreated', () => {
    const before = Date.now()
    const result = mapInboundPayload(makePayload({ dateCreated: null }))
    const after = Date.now()

    expect(result.kind).toBe('message')
    if (result.kind !== 'message') throw new Error('expected a message event')
    expect(result.message.receivedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.message.receivedAt.getTime()).toBeLessThanOrEqual(after)
  })

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'ignores a prototype-chain key "%s" as an associatedMessageType rather than treating it as a valid reaction',
    (dangerousKey) => {
      const result = mapInboundPayload(
        makePayload({ text: null, associatedMessageType: dangerousKey }),
      )

      expect(result).toEqual({
        kind: 'ignored',
        reason: `unhandled or removed reaction: ${dangerousKey}`,
      })
    },
  )
})

// --- BlueBubblesInboundAdapter -----------------------------------------

type ConnectFn = NonNullable<BlueBubblesInboundAdapterOptions['connect']>

interface FakeSocket {
  on: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

interface FakeSocketHandle {
  socket: FakeSocket
  listeners: Map<string, (raw: unknown) => void>
}

// The adapter is only ever handed the result of `io(...)` and only ever
// calls `.on()` and `.disconnect()` on it, so a plain object with those two
// spies is a faithful test double. It cannot be *structurally* typed as the
// real socket.io-client `Socket` (that class carries private fields, which
// make any plain object literal non-assignable to it), so the cast to
// `ConnectFn` goes through `unknown` -- standard for injecting a fake behind
// a third-party class type.
function createFakeSocketFactory(): {
  connect: ConnectFn
  spy: ReturnType<typeof vi.fn>
  sockets: FakeSocketHandle[]
  emit: (event: string, raw: unknown, socketIndex?: number) => void
} {
  const sockets: FakeSocketHandle[] = []

  const spy = vi.fn((_url: string, _opts?: Record<string, unknown>): FakeSocket => {
    const listeners = new Map<string, (raw: unknown) => void>()
    const socket: FakeSocket = {
      on: vi.fn((event: string, listener: (raw: unknown) => void) => {
        listeners.set(event, listener)
        return socket
      }),
      disconnect: vi.fn(() => socket),
    }
    sockets.push({ socket, listeners })
    return socket
  })

  return {
    spy,
    connect: spy as unknown as ConnectFn,
    sockets,
    emit(event: string, raw: unknown, socketIndex = sockets.length - 1): void {
      const handle = sockets[socketIndex]
      const listener = handle?.listeners.get(event)
      if (listener === undefined) {
        throw new Error(`no listener registered for event "${event}" on socket #${socketIndex}`)
      }
      listener(raw)
    },
  }
}

// `dispatch()` is async and awaits each handler in turn; a plain microtask
// tick is not always enough once there's more than one handler in the
// chain, but draining until the next macrotask phase (setImmediate) is --
// Node always finishes the whole microtask queue, however deep, before
// running a queued setImmediate callback.
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

describe('BlueBubblesInboundAdapter', () => {
  describe('connect', () => {
    it('calls the io factory with the server url and the password in the query', () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })

      adapter.connect()

      expect(factory.spy).toHaveBeenCalledTimes(1)
      expect(factory.spy).toHaveBeenCalledWith('http://127.0.0.1:1234', {
        query: { password: 'secret-pw' },
      })
    })

    it('does not create a second socket connection on a second connect() call', () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })

      adapter.connect()
      adapter.connect()
      adapter.connect()

      expect(factory.spy).toHaveBeenCalledTimes(1)
      expect(factory.sockets).toHaveLength(1)
    })
  })

  describe('event routing', () => {
    it('routes a mapped message event to every registered onMessage handler, in registration order', async () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })
      adapter.connect()

      const order: string[] = []
      const handlerA = vi.fn((_message: TransportInboundMessage) => {
        order.push('A')
      })
      const handlerB = vi.fn((_message: TransportInboundMessage) => {
        order.push('B')
      })
      adapter.onMessage(handlerA)
      adapter.onMessage(handlerB)

      factory.emit(NEW_MESSAGE_EVENT, makePayload())
      await flush()

      const expectedMessage: TransportInboundMessage = {
        messageId: 'msg-1',
        groupId: 'chat-guid-1',
        senderId: '+15551234567',
        text: 'hello there',
        receivedAt: RECEIVED_AT,
      }
      expect(handlerA).toHaveBeenCalledTimes(1)
      expect(handlerA).toHaveBeenCalledWith(expectedMessage)
      expect(handlerB).toHaveBeenCalledTimes(1)
      expect(handlerB).toHaveBeenCalledWith(expectedMessage)
      expect(order).toEqual(['A', 'B'])
    })

    it('routes a mapped interaction event to onCardInteraction handlers, and never to onMessage handlers', async () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })
      adapter.connect()

      const messageHandler = vi.fn()
      const interactionHandler = vi.fn((_interaction: TransportCardInteraction) => undefined)
      adapter.onMessage(messageHandler)
      adapter.onCardInteraction(interactionHandler)

      factory.emit(
        NEW_MESSAGE_EVENT,
        makePayload({ guid: 'reaction-1', text: null, associatedMessageType: 'dislike' }),
      )
      await flush()

      const expectedInteraction: TransportCardInteraction = {
        interactionId: 'reaction-1',
        groupId: 'chat-guid-1',
        senderId: '+15551234567',
        action: 'veto',
        receivedAt: RECEIVED_AT,
      }
      expect(interactionHandler).toHaveBeenCalledTimes(1)
      expect(interactionHandler).toHaveBeenCalledWith(expectedInteraction)
      expect(messageHandler).not.toHaveBeenCalled()
    })

    it('keeps message and interaction handlers independent across multiple events, in call order', async () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })
      adapter.connect()

      const order: string[] = []
      const messageHandlerA = vi.fn(() => {
        order.push('message-A')
      })
      const messageHandlerB = vi.fn(() => {
        order.push('message-B')
      })
      const interactionHandler = vi.fn(() => {
        order.push('interaction')
      })
      adapter.onMessage(messageHandlerA)
      adapter.onCardInteraction(interactionHandler)
      adapter.onMessage(messageHandlerB)

      factory.emit(NEW_MESSAGE_EVENT, makePayload({ guid: 'm-1' }))
      await flush()

      expect(messageHandlerA).toHaveBeenCalledTimes(1)
      expect(messageHandlerB).toHaveBeenCalledTimes(1)
      expect(interactionHandler).not.toHaveBeenCalled()
      expect(order).toEqual(['message-A', 'message-B'])

      factory.emit(
        NEW_MESSAGE_EVENT,
        makePayload({ guid: 'r-1', text: null, associatedMessageType: 'love' }),
      )
      await flush()

      expect(interactionHandler).toHaveBeenCalledTimes(1)
      expect(messageHandlerA).toHaveBeenCalledTimes(1)
      expect(messageHandlerB).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['message-A', 'message-B', 'interaction'])
    })

    it('does not invoke any handler for an ignored event', async () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })
      adapter.connect()

      const messageHandler = vi.fn()
      const interactionHandler = vi.fn()
      adapter.onMessage(messageHandler)
      adapter.onCardInteraction(interactionHandler)

      factory.emit(NEW_MESSAGE_EVENT, makePayload({ isFromMe: true }))
      await flush()

      expect(messageHandler).not.toHaveBeenCalled()
      expect(interactionHandler).not.toHaveBeenCalled()
    })

    it('stops calling a handler once its returned unsubscribe function is invoked', async () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })
      adapter.connect()

      const handlerA = vi.fn()
      const handlerB = vi.fn()
      const unsubscribeA = adapter.onMessage(handlerA)
      adapter.onMessage(handlerB)

      // Sanity check: both fire on a first event.
      factory.emit(NEW_MESSAGE_EVENT, makePayload({ guid: 'm-1' }))
      await flush()
      expect(handlerA).toHaveBeenCalledTimes(1)
      expect(handlerB).toHaveBeenCalledTimes(1)

      unsubscribeA()

      factory.emit(NEW_MESSAGE_EVENT, makePayload({ guid: 'm-2' }))
      await flush()

      expect(handlerA).toHaveBeenCalledTimes(1)
      expect(handlerB).toHaveBeenCalledTimes(2)
    })

    it('stops calling an onCardInteraction handler once unsubscribed', async () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })
      adapter.connect()

      const interactionHandler = vi.fn()
      const unsubscribe = adapter.onCardInteraction(interactionHandler)
      unsubscribe()

      factory.emit(
        NEW_MESSAGE_EVENT,
        makePayload({ guid: 'r-1', text: null, associatedMessageType: 'like' }),
      )
      await flush()

      expect(interactionHandler).not.toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('calls the underlying socket disconnect and allows a subsequent connect() to reconnect', () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })

      adapter.connect()
      const firstSocket = factory.sockets[0]?.socket
      adapter.disconnect()

      expect(firstSocket?.disconnect).toHaveBeenCalledTimes(1)
      expect(factory.spy).toHaveBeenCalledTimes(1)

      adapter.connect()

      expect(factory.spy).toHaveBeenCalledTimes(2)
      expect(factory.sockets).toHaveLength(2)
    })

    it('is a safe no-op when called before connect()', () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })

      expect(() => adapter.disconnect()).not.toThrow()
      expect(factory.spy).not.toHaveBeenCalled()
    })
  })

  describe('handler failures', () => {
    it('reports a throwing handler via onConnectionIssue and still runs handlers registered after it', async () => {
      const factory = createFakeSocketFactory()
      const onConnectionIssue = vi.fn()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
        onConnectionIssue,
      })
      adapter.connect()

      const boom = new Error('downstream write failed')
      const handlerA = vi.fn(() => {
        throw boom
      })
      const handlerB = vi.fn()
      adapter.onMessage(handlerA)
      adapter.onMessage(handlerB)

      factory.emit(NEW_MESSAGE_EVENT, makePayload())
      await flush()

      expect(handlerA).toHaveBeenCalledTimes(1)
      expect(handlerB).toHaveBeenCalledTimes(1)
      expect(onConnectionIssue).toHaveBeenCalledWith({ type: 'handler_error', detail: boom })
    })

    it('reports a rejecting async handler the same way as a throwing one', async () => {
      const factory = createFakeSocketFactory()
      const onConnectionIssue = vi.fn()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
        onConnectionIssue,
      })
      adapter.connect()

      const boom = new Error('async downstream failure')
      adapter.onMessage(() => Promise.reject(boom))

      factory.emit(NEW_MESSAGE_EVENT, makePayload())
      await flush()

      expect(onConnectionIssue).toHaveBeenCalledWith({ type: 'handler_error', detail: boom })
    })

    it('does not crash the process (no unhandled rejection) when a handler rejects', async () => {
      const unhandled = vi.fn()
      process.once('unhandledRejection', unhandled)
      try {
        const factory = createFakeSocketFactory()
        const adapter = new BlueBubblesInboundAdapter({
          server_url: 'http://127.0.0.1:1234',
          password: 'secret-pw',
          connect: factory.connect,
          onConnectionIssue: () => undefined,
        })
        adapter.connect()
        adapter.onMessage(() => Promise.reject(new Error('boom')))

        factory.emit(NEW_MESSAGE_EVENT, makePayload())
        await flush()

        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.removeListener('unhandledRejection', unhandled)
      }
    })
  })

  describe('connection visibility', () => {
    it('reports connect_error via onConnectionIssue', () => {
      const factory = createFakeSocketFactory()
      const onConnectionIssue = vi.fn()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
        onConnectionIssue,
      })
      adapter.connect()

      const authError = new Error('invalid password')
      factory.emit('connect_error', authError)

      expect(onConnectionIssue).toHaveBeenCalledWith({ type: 'connect_error', detail: authError })
    })

    it('reports disconnect via onConnectionIssue', () => {
      const factory = createFakeSocketFactory()
      const onConnectionIssue = vi.fn()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
        onConnectionIssue,
      })
      adapter.connect()

      factory.emit('disconnect', 'transport close')

      expect(onConnectionIssue).toHaveBeenCalledWith({
        type: 'disconnect',
        detail: 'transport close',
      })
    })

    it('defaults to logging via console.error when no onConnectionIssue is supplied', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const factory = createFakeSocketFactory()
        const adapter = new BlueBubblesInboundAdapter({
          server_url: 'http://127.0.0.1:1234',
          password: 'secret-pw',
          connect: factory.connect,
        })
        adapter.connect()

        factory.emit('disconnect', 'ping timeout')

        expect(consoleErrorSpy).toHaveBeenCalled()
      } finally {
        consoleErrorSpy.mockRestore()
      }
    })
  })

  describe('dispatch ordering', () => {
    it('processes a second event only after the first event finishes, even with a genuinely slow async handler', async () => {
      const factory = createFakeSocketFactory()
      const adapter = new BlueBubblesInboundAdapter({
        server_url: 'http://127.0.0.1:1234',
        password: 'secret-pw',
        connect: factory.connect,
      })
      adapter.connect()

      const order: string[] = []
      let releaseFirst: (() => void) | undefined
      const firstEventGate = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })

      adapter.onMessage(async (message) => {
        if (message.messageId === 'm-1') {
          order.push('m-1-start')
          await firstEventGate
          order.push('m-1-end')
          return
        }
        order.push(message.messageId)
      })

      factory.emit(NEW_MESSAGE_EVENT, makePayload({ guid: 'm-1' }))
      factory.emit(NEW_MESSAGE_EVENT, makePayload({ guid: 'm-2' }))

      // Give the first event's handler a chance to start and block.
      await flush()
      expect(order).toEqual(['m-1-start'])

      // The second event must NOT have been processed yet — if dispatch
      // fired both events as independent, unserialized async chains, m-2
      // would already be in `order` here.
      releaseFirst?.()
      await flush()

      expect(order).toEqual(['m-1-start', 'm-1-end', 'm-2'])
    })
  })
})

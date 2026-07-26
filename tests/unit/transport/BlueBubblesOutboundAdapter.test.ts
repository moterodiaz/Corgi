import { describe, expect, it, vi } from 'vitest'

import { BlueBubblesOutboundAdapter } from '../../../src/transport/BlueBubblesOutboundAdapter.js'
import type {
  BlueBubblesClient,
  SendTextInput,
  SentMessage,
} from '../../../src/transport/BlueBubblesClient.js'
import type { TransportPort } from '../../../src/transport/TransportPort.js'

// A fake BlueBubblesClient (matching its exported interface) rather than
// mocking fetch -- BlueBubblesOutboundAdapter's own logic is what these
// tests cover, not BlueBubblesClient's HTTP/parsing behavior.
function createFakeClient(): BlueBubblesClient & { calls: SendTextInput[] } {
  const calls: SendTextInput[] = []
  let counter = 0

  return {
    calls,
    sendText: vi.fn(async (input: SendTextInput): Promise<SentMessage> => {
      calls.push(input)
      counter += 1
      return {
        guid: `guid-${counter}`,
        dateCreated: new Date(2026, 0, 1, 0, 0, counter),
      }
    }),
  }
}

describe('BlueBubblesOutboundAdapter', () => {
  describe('sendMessage', () => {
    it("returns a TransportSentMessage built from the client's response", async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client })

      const sent = await adapter.sendMessage({ groupId: 'chat-guid-1', text: 'hello there' })

      expect(sent).toEqual({
        messageId: 'guid-1',
        groupId: 'chat-guid-1',
        text: 'hello there',
        sentAt: new Date(2026, 0, 1, 0, 0, 1),
      })
      expect(client.calls).toEqual([{ chatGuid: 'chat-guid-1', message: 'hello there' }])
    })

    it('does not pass a selectedMessageGuid on a plain send', async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client, privateApiEnabled: true })

      await adapter.sendMessage({ groupId: 'chat-guid-1', text: 'hello there' })

      expect(client.calls[0]).not.toHaveProperty('selectedMessageGuid')
    })
  })

  describe('updateCard', () => {
    it("sends a new message using the payload's text field", async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client })

      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'revised plan text', status: 'revising' },
      })

      expect(client.calls).toEqual([{ chatGuid: 'chat-guid-1', message: 'revised plan text' }])
    })

    it('throws a clear error when payload.text is missing', async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client })

      await expect(
        adapter.updateCard({ groupId: 'chat-guid-1', cardId: 'plan-1', payload: {} }),
      ).rejects.toThrow("updateCard payload requires a non-empty string 'text' field")
      expect(client.calls).toHaveLength(0)
    })

    it('throws a clear error when payload.text is not a string', async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client })

      await expect(
        adapter.updateCard({ groupId: 'chat-guid-1', cardId: 'plan-1', payload: { text: 42 } }),
      ).rejects.toThrow("updateCard payload requires a non-empty string 'text' field")
      expect(client.calls).toHaveLength(0)
    })

    it('throws a clear error when payload.text is an empty string', async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client })

      await expect(
        adapter.updateCard({ groupId: 'chat-guid-1', cardId: 'plan-1', payload: { text: '' } }),
      ).rejects.toThrow("updateCard payload requires a non-empty string 'text' field")
      expect(client.calls).toHaveLength(0)
    })

    it('never passes selectedMessageGuid when privateApiEnabled is false, even on a second call for the same cardId', async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client, privateApiEnabled: false })

      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v1' },
      })
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v2' },
      })

      expect(client.calls).toEqual([
        { chatGuid: 'chat-guid-1', message: 'v1' },
        { chatGuid: 'chat-guid-1', message: 'v2' },
      ])
      for (const call of client.calls) {
        expect(call).not.toHaveProperty('selectedMessageGuid')
      }
    })

    it('defaults privateApiEnabled to false when the option is omitted', async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client })

      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v1' },
      })
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v2' },
      })

      for (const call of client.calls) {
        expect(call).not.toHaveProperty('selectedMessageGuid')
      }
    })

    it("threads the second call's selectedMessageGuid to the first call's returned guid when privateApiEnabled is true", async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client, privateApiEnabled: true })

      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v1' },
      })
      // First call's fake guid is "guid-1".
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v2' },
      })

      expect(client.calls[0]).not.toHaveProperty('selectedMessageGuid')
      expect(client.calls[1]).toEqual({
        chatGuid: 'chat-guid-1',
        message: 'v2',
        selectedMessageGuid: 'guid-1',
      })
    })

    it("always threads back to the FIRST call's guid, not a chained/previous one, on a third call", async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client, privateApiEnabled: true })

      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v1' },
      })
      // First call returns guid "guid-1" -- this must remain the thread anchor.
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v2' },
      })
      // Second call returns guid "guid-2" -- must NOT become the new anchor.
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-1',
        payload: { text: 'v3' },
      })

      expect(client.calls[1]).toMatchObject({ selectedMessageGuid: 'guid-1' })
      expect(client.calls[2]).toMatchObject({ selectedMessageGuid: 'guid-1' })
      expect(client.calls[2]).not.toMatchObject({ selectedMessageGuid: 'guid-2' })
    })

    it('tracks different cardIds independently, with no cross-contamination', async () => {
      const client = createFakeClient()
      const adapter = new BlueBubblesOutboundAdapter({ client, privateApiEnabled: true })

      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-A',
        payload: { text: 'A v1' },
      })
      // guid-1 anchors plan-A
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-B',
        payload: { text: 'B v1' },
      })
      // guid-2 anchors plan-B (first message for a *different* cardId, so no selectedMessageGuid yet)
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-A',
        payload: { text: 'A v2' },
      })
      // Should thread to plan-A's first guid (guid-1), not plan-B's.
      await adapter.updateCard({
        groupId: 'chat-guid-1',
        cardId: 'plan-B',
        payload: { text: 'B v2' },
      })
      // Should thread to plan-B's first guid (guid-2), not plan-A's.

      expect(client.calls[0]).not.toHaveProperty('selectedMessageGuid') // plan-A v1
      expect(client.calls[1]).not.toHaveProperty('selectedMessageGuid') // plan-B v1
      expect(client.calls[2]).toMatchObject({ selectedMessageGuid: 'guid-1', message: 'A v2' })
      expect(client.calls[3]).toMatchObject({ selectedMessageGuid: 'guid-2', message: 'B v2' })
    })

    it("propagates the client's error and does not swallow it", async () => {
      const client: BlueBubblesClient = {
        sendText: vi.fn().mockRejectedValue(new Error('upstream_error')),
      }
      const adapter = new BlueBubblesOutboundAdapter({ client })

      await expect(
        adapter.updateCard({ groupId: 'chat-guid-1', cardId: 'plan-1', payload: { text: 'v1' } }),
      ).rejects.toThrow('upstream_error')
    })
  })

  describe('onMessage / onCardInteraction', () => {
    it('onMessage returns a no-op unsubscribe function and never invokes the handler', () => {
      const client = createFakeClient()
      // Typed as TransportPort: this adapter is outbound-only, and the port
      // interface (not just this class's own signature) is the real contract
      // callers rely on.
      const adapter: TransportPort = new BlueBubblesOutboundAdapter({ client })
      const handler = vi.fn()

      const unsubscribe = adapter.onMessage(handler)

      expect(typeof unsubscribe).toBe('function')
      expect(() => unsubscribe()).not.toThrow()
      expect(handler).not.toHaveBeenCalled()
    })

    it('onCardInteraction returns a no-op unsubscribe function and never invokes the handler', () => {
      const client = createFakeClient()
      const adapter: TransportPort = new BlueBubblesOutboundAdapter({ client })
      const handler = vi.fn()

      const unsubscribe = adapter.onCardInteraction(handler)

      expect(typeof unsubscribe).toBe('function')
      expect(() => unsubscribe()).not.toThrow()
      expect(handler).not.toHaveBeenCalled()
    })
  })
})

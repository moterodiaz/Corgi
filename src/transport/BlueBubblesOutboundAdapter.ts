import type { BlueBubblesClient } from './BlueBubblesClient.js'
import {
  type TransportPort,
  type TransportSendMessageInput,
  type TransportSentMessage,
  type TransportUpdateCardInput,
  type Unsubscribe,
} from './TransportPort.js'

// BlueBubbles has no equivalent of Spectrum's mini-app card (a live,
// in-place-editable widget) or its poll component — plain iMessage has
// neither concept, and BlueBubbles' documented API has no message-edit
// endpoint (verified 2026-07-26 against bluebubbles-server's REST routes).
// updateCard is therefore honestly a "send a new message representing the
// revision", not a literal in-place edit. `cardId` is caller-chosen and
// stable (e.g. Corgi's own plan_id) — it does not need to be, and is not
// used as, a BlueBubbles message GUID; this adapter tracks the first
// message sent per cardId itself, purely to optionally thread later
// revisions as replies when Private API is enabled.
export interface BlueBubblesOutboundAdapterOptions {
  client: BlueBubblesClient
  // Reply-threading (selectedMessageGuid) requires BlueBubbles' Private API,
  // which requires disabling System Integrity Protection — a real security
  // trade-off the operator opts into separately, not something this adapter
  // assumes. Defaults to false (plain AppleScript sending, no threading).
  privateApiEnabled?: boolean
}

export class BlueBubblesOutboundAdapter implements TransportPort {
  private readonly client: BlueBubblesClient
  private readonly privateApiEnabled: boolean
  private readonly firstMessageByCardId = new Map<string, string>()

  constructor(options: BlueBubblesOutboundAdapterOptions) {
    this.client = options.client
    this.privateApiEnabled = options.privateApiEnabled ?? false
  }

  onMessage(): Unsubscribe {
    // Outbound adapter does not handle inbound subscriptions — see
    // BlueBubblesInboundAdapter.
    return () => undefined
  }

  onCardInteraction(): Unsubscribe {
    return () => undefined
  }

  async sendMessage(input: TransportSendMessageInput): Promise<TransportSentMessage> {
    const sent = await this.client.sendText({ chatGuid: input.groupId, message: input.text })

    return {
      messageId: sent.guid,
      groupId: input.groupId,
      text: input.text,
      sentAt: sent.dateCreated,
    }
  }

  async updateCard(input: TransportUpdateCardInput): Promise<void> {
    const text = getStringField(input.payload, 'text')
    const replyTo = this.privateApiEnabled ? this.firstMessageByCardId.get(input.cardId) : undefined

    const sent = await this.client.sendText({
      chatGuid: input.groupId,
      message: text,
      ...(replyTo === undefined ? {} : { selectedMessageGuid: replyTo }),
    })

    if (!this.firstMessageByCardId.has(input.cardId)) {
      this.firstMessageByCardId.set(input.cardId, sent.guid)
    }
  }
}

function getStringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`updateCard payload requires a non-empty string '${field}' field`)
  }

  return value
}

import {
  type TransportCardInteraction,
  type TransportInboundMessage,
  type TransportPort,
  type TransportSendMessageInput,
  type TransportSentMessage,
  type TransportUpdateCardInput,
  type Unsubscribe,
} from './TransportPort.js'

export class InMemoryTransportPort implements TransportPort {
  public readonly sentMessages: TransportSendMessageInput[] = []
  public readonly cardUpdates: TransportUpdateCardInput[] = []

  private messageHandlers: Array<(message: TransportInboundMessage) => Promise<void> | void> = []

  private cardInteractionHandlers: Array<
    (interaction: TransportCardInteraction) => Promise<void> | void
  > = []

  private sentMessageCounter = 0

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

  async sendMessage(input: TransportSendMessageInput): Promise<TransportSentMessage> {
    this.sentMessages.push(input)

    this.sentMessageCounter += 1

    return {
      messageId: `mem-msg-${this.sentMessageCounter}`,
      groupId: input.groupId,
      text: input.text,
      sentAt: new Date(),
    }
  }

  async updateCard(input: TransportUpdateCardInput): Promise<void> {
    this.cardUpdates.push(input)
  }

  async emitMessage(message: TransportInboundMessage): Promise<void> {
    const handlers = [...this.messageHandlers]

    for (const handler of handlers) {
      await handler(message)
    }
  }

  async emitCardInteraction(interaction: TransportCardInteraction): Promise<void> {
    const handlers = [...this.cardInteractionHandlers]

    for (const handler of handlers) {
      await handler(interaction)
    }
  }
}

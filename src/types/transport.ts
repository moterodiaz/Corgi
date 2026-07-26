// Phase 2 implementations land in src/transport/. Nothing outside that folder
// should import spectrum-ts directly — use this interface instead.

export interface InboundMessage {
  groupId: string
  sender: string
  text: string
  timestamp: string // ISO-8601
}

export interface CardInteraction {
  groupId: string
  cardId: string
  sender: string
  action: 'attending' | 'not_attending' | 'suggest_other'
}

export interface TransportPort {
  onMessage(handler: (message: InboundMessage) => Promise<void>): void
  onCardInteraction(handler: (interaction: CardInteraction) => Promise<void>): void
  sendMessage(groupId: string, text: string): Promise<void>
  updateCard(groupId: string, cardId: string, plan: unknown): Promise<void>
}

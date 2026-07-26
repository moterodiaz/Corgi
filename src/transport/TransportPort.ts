export type Unsubscribe = () => void;

export interface TransportInboundMessage {
  messageId: string;
  groupId: string;
  senderId: string;
  text: string;
  receivedAt: Date;
}

export type CardInteractionAction = "accept" | "veto" | "suggest-alternative";

export interface TransportCardInteraction {
  interactionId: string;
  groupId: string;
  senderId: string;
  action: CardInteractionAction;
  cardId?: string;
  note?: string;
  receivedAt: Date;
}

export interface TransportSendMessageInput {
  groupId: string;
  text: string;
}

export interface TransportSentMessage {
  messageId: string;
  groupId: string;
  text: string;
  sentAt: Date;
}

export interface TransportUpdateCardInput {
  groupId: string;
  cardId: string;
  payload: Record<string, unknown>;
}

export interface TransportPort {
  onMessage(handler: (message: TransportInboundMessage) => Promise<void> | void): Unsubscribe;

  onCardInteraction(
    handler: (interaction: TransportCardInteraction) => Promise<void> | void
  ): Unsubscribe;

  sendMessage(input: TransportSendMessageInput): Promise<TransportSentMessage>;

  updateCard(input: TransportUpdateCardInput): Promise<void>;
}

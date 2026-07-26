import { app, edit, poll, type Message } from "spectrum-ts";

import {
  type TransportPort,
  type TransportSendMessageInput,
  type TransportSentMessage,
  type TransportUpdateCardInput,
  type Unsubscribe,
} from "./TransportPort.js";

interface SpectrumSpaceLike {
  id: string;
  send(content: unknown): Promise<Message | undefined>;
}

export interface SpectrumOutboundAdapterOptions {
  resolveSpace: (groupId: string) => Promise<SpectrumSpaceLike>;
}

export interface CreateCardInput {
  groupId: string;
  url: string;
  live?: boolean;
}

export interface SendPollInput {
  groupId: string;
  title: string;
  options: string[];
}

interface StoredCardMessage {
  groupId: string;
  message: Message;
}

export class SpectrumOutboundAdapter implements TransportPort {
  private readonly resolveSpace: (groupId: string) => Promise<SpectrumSpaceLike>;
  private readonly cardMessages = new Map<string, StoredCardMessage>();

  constructor(options: SpectrumOutboundAdapterOptions) {
    this.resolveSpace = options.resolveSpace;
  }

  onMessage(): Unsubscribe {
    // Outbound adapter does not handle inbound subscriptions.
    return () => undefined;
  }

  onCardInteraction(): Unsubscribe {
    // Outbound adapter does not handle inbound subscriptions.
    return () => undefined;
  }

  async sendMessage(input: TransportSendMessageInput): Promise<TransportSentMessage> {
    const space = await this.resolveSpace(input.groupId);

    const sent = await space.send(input.text);

    if (!sent) {
      throw new Error("sendMessage did not return a message handle");
    }

    return {
      messageId: sent.id,
      groupId: input.groupId,
      text: input.text,
      sentAt: sent.timestamp,
    };
  }

  async createCard(input: CreateCardInput): Promise<string> {
    const space = await this.resolveSpace(input.groupId);

    const sent = await space.send(
      app(input.url, {
        live: input.live ?? true,
      })
    );

    if (!sent) {
      throw new Error("createCard did not return a message handle");
    }

    this.cardMessages.set(sent.id, {
      groupId: input.groupId,
      message: sent,
    });

    return sent.id;
  }

  async updateCard(input: TransportUpdateCardInput): Promise<void> {
    const existing = this.cardMessages.get(input.cardId);

    if (!existing) {
      throw new Error(`Cannot update card ${input.cardId}: card handle not found`);
    }

    if (existing.groupId !== input.groupId) {
      throw new Error(
        `Cannot update card ${input.cardId}: group mismatch ${existing.groupId} vs ${input.groupId}`
      );
    }

    const url = getStringField(input.payload, "url");
    const live = getBooleanField(input.payload, "live") ?? true;

    const space = await this.resolveSpace(input.groupId);

    await space.send(
      edit(
        app(url, {
          live,
        }),
        existing.message
      )
    );
  }

  async sendPoll(input: SendPollInput): Promise<void> {
    if (input.options.length < 2) {
      throw new Error("poll requires at least two options");
    }

    const space = await this.resolveSpace(input.groupId);

    await space.send(poll(input.title, input.options));
  }
}

function getStringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`updateCard payload requires a non-empty string '${field}' field`);
  }

  return value;
}

function getBooleanField(
  payload: Record<string, unknown>,
  field: string
): boolean | undefined {
  const value = payload[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`updateCard payload field '${field}' must be boolean when provided`);
  }

  return value;
}

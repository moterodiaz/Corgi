import {
  type CardInteractionAction,
  type TransportCardInteraction,
  type TransportInboundMessage,
  type Unsubscribe,
} from "./TransportPort.js";

export interface SpectrumWebhookRawRequest {
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface SpectrumWebhookResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface SpectrumWebhookLikeMessage {
  id: string;
  direction: "inbound" | "outbound";
  platform: string;
  sender?: { id: string };
  space: { id: string };
  timestamp: Date;
  content:
    | { type: "text"; text: string }
    | {
        type: "poll_option";
        selected: boolean;
        title: string;
      }
    | { type: "custom"; raw: unknown }
    | { type: string; [key: string]: unknown };
}

export type SpectrumWebhookFunction = (
  request: SpectrumWebhookRawRequest,
  handler: (space: { id: string }, message: SpectrumWebhookLikeMessage) => Promise<void>
) => Promise<{
  status: number;
  headers?: Record<string, string>;
  body?: Buffer | string | Uint8Array;
}>;

export interface FixedWindowRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

export class FixedWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly counters = new Map<string, { count: number; windowStart: number }>();

  constructor(options: FixedWindowRateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  consume(key: string): boolean {
    const nowMs = this.now();
    const current = this.counters.get(key);

    if (!current || nowMs - current.windowStart >= this.windowMs) {
      this.counters.set(key, { count: 1, windowStart: nowMs });
      return true;
    }

    if (current.count >= this.maxRequests) {
      return false;
    }

    current.count += 1;
    return true;
  }
}

export interface SpectrumWebhookInboundAdapterOptions {
  webhook: SpectrumWebhookFunction;
  webhookSecretConfigured: boolean;
  rateLimiter?: FixedWindowRateLimiter;
  extractClientKey?: (headers: Record<string, string | string[] | undefined>) => string;
}

export class SpectrumWebhookInboundAdapter {
  private readonly webhook: SpectrumWebhookFunction;
  private readonly webhookSecretConfigured: boolean;
  private readonly rateLimiter: FixedWindowRateLimiter;
  private readonly extractClientKey: (
    headers: Record<string, string | string[] | undefined>
  ) => string;

  private messageHandlers: Array<
    (message: TransportInboundMessage) => Promise<void> | void
  > = [];

  private cardInteractionHandlers: Array<
    (interaction: TransportCardInteraction) => Promise<void> | void
  > = [];

  constructor(options: SpectrumWebhookInboundAdapterOptions) {
    this.webhook = options.webhook;
    this.webhookSecretConfigured = options.webhookSecretConfigured;
    this.rateLimiter =
      options.rateLimiter ??
      new FixedWindowRateLimiter({
        maxRequests: 60,
        windowMs: 60_000,
      });

    this.extractClientKey =
      options.extractClientKey ??
      ((headers) => {
        const forwardedFor = headers["x-forwarded-for"];
        if (Array.isArray(forwardedFor)) {
          return forwardedFor[0] ?? "unknown";
        }

        return forwardedFor ?? "unknown";
      });
  }

  onMessage(handler: (message: TransportInboundMessage) => Promise<void> | void): Unsubscribe {
    this.messageHandlers.push(handler);

    return () => {
      this.messageHandlers = this.messageHandlers.filter((fn) => fn !== handler);
    };
  }

  onCardInteraction(
    handler: (interaction: TransportCardInteraction) => Promise<void> | void
  ): Unsubscribe {
    this.cardInteractionHandlers.push(handler);

    return () => {
      this.cardInteractionHandlers = this.cardInteractionHandlers.filter(
        (fn) => fn !== handler
      );
    };
  }

  async handleWebhook(request: SpectrumWebhookRawRequest): Promise<SpectrumWebhookResponse> {
    // If no webhook secret is configured, we cannot verify authenticity.
    if (!this.webhookSecretConfigured) {
      return {
        status: 500,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            error: "SPECTRUM_WEBHOOK_SECRET is required for verified webhook ingestion",
          })
        ),
      };
    }

    const clientKey = this.extractClientKey(request.headers);

    if (!this.rateLimiter.consume(clientKey)) {
      return {
        status: 429,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ error: "rate limit exceeded" })),
      };
    }

    const result = await this.webhook(request, async (space, message) => {
      await this.dispatchInbound(space, message);
    });

    return {
      status: result.status,
      headers: result.headers ?? {},
      body: toBuffer(result.body),
    };
  }

  private async dispatchInbound(
    space: { id: string },
    message: SpectrumWebhookLikeMessage
  ): Promise<void> {
    if (message.direction !== "inbound") {
      return;
    }

    if (message.content.type === "text") {
      const transportMessage: TransportInboundMessage = {
        messageId: message.id,
        groupId: space.id,
        senderId: message.sender?.id ?? "unknown",
        text: message.content.text,
        receivedAt: message.timestamp,
      };

      const handlers = [...this.messageHandlers];
      for (const handler of handlers) {
        await handler(transportMessage);
      }
      return;
    }

    const interaction = toCardInteraction(space, message);

    if (!interaction) {
      return;
    }

    const handlers = [...this.cardInteractionHandlers];
    for (const handler of handlers) {
      await handler(interaction);
    }
  }
}

function toCardInteraction(
  space: { id: string },
  message: SpectrumWebhookLikeMessage
): TransportCardInteraction | undefined {
  if (message.content.type === "poll_option") {
    const action: CardInteractionAction = message.content.selected ? "accept" : "veto";

    return {
      interactionId: message.id,
      groupId: space.id,
      senderId: message.sender?.id ?? "unknown",
      action,
      note: message.content.title,
      receivedAt: message.timestamp,
    };
  }

  if (message.content.type === "custom" && isCardInteractionRaw(message.content.raw)) {
    return {
      interactionId: message.id,
      groupId: space.id,
      senderId: message.sender?.id ?? "unknown",
      action: message.content.raw.action,
      cardId: message.content.raw.cardId,
      note: message.content.raw.note,
      receivedAt: message.timestamp,
    };
  }

  return undefined;
}

function isCardInteractionRaw(
  value: unknown
): value is { action: CardInteractionAction; cardId?: string; note?: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const action = (value as { action?: unknown }).action;

  return (
    action === "accept" ||
    action === "veto" ||
    action === "suggest-alternative"
  );
}

function toBuffer(value: Buffer | string | Uint8Array | undefined): Buffer {
  if (!value) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    return Buffer.from(value);
  }

  return Buffer.from(value);
}

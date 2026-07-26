import type { PlanCardPayload } from "./PlanCardTemplate.js";
import type { TransportUpdateCardInput } from "./TransportPort.js";

export interface PlanCardTransport {
  createCard(input: { groupId: string; url: string; live?: boolean }): Promise<string>;
  updateCard(input: TransportUpdateCardInput): Promise<void>;
}

export interface PlanCardRevisionManagerOptions {
  transport: PlanCardTransport;
  toCardUrl?: (payload: PlanCardPayload) => string;
}

export class PlanCardRevisionManager {
  private readonly transport: PlanCardTransport;
  private readonly toCardUrl: (payload: PlanCardPayload) => string;
  private readonly groupCardIds = new Map<string, string>();

  constructor(options: PlanCardRevisionManagerOptions) {
    this.transport = options.transport;
    this.toCardUrl = options.toCardUrl ?? defaultToCardUrl;
  }

  async postInitialPlan(groupId: string, payload: PlanCardPayload): Promise<string> {
    const existing = this.groupCardIds.get(groupId);
    if (existing) {
      return existing;
    }

    const url = this.toCardUrl(payload);
    const cardId = await this.transport.createCard({
      groupId,
      url,
      live: true,
    });

    this.groupCardIds.set(groupId, cardId);
    return cardId;
  }

  async applyRevision(groupId: string, payload: PlanCardPayload): Promise<string> {
    const cardId = this.groupCardIds.get(groupId);

    if (!cardId) {
      throw new Error(`No initial card exists for group ${groupId}`);
    }

    await this.transport.updateCard({
      groupId,
      cardId,
      payload: {
        url: this.toCardUrl(payload),
        live: true,
      },
    });

    return cardId;
  }
}

function defaultToCardUrl(payload: PlanCardPayload): string {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `https://example.com/corgi/plan-card?payload=${encoded}`;
}

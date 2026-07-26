import { describe, expect, it, vi } from "vitest";

import type { PlanCardPayload } from "../../../src/transport/PlanCardTemplate.js";
import { PlanCardRevisionManager } from "../../../src/transport/PlanCardRevisionManager.js";

function makePayload(version: number): PlanCardPayload {
  return {
    kind: "corgi.plan-card",
    planId: "plan-1",
    version,
    status: version === 1 ? "proposed" : "revising",
    headline: "Climbing at Boulders Club",
    details: {
      activity: "climbing",
      venue: "Boulders Club",
      datetime: "2026-08-02T21:00:00.000Z",
      costTier: "low",
    },
    rationale: "good fit for everyone",
    rsvp: [
      { attendee: "sam", state: "yes" },
      { attendee: "jess", state: "pending" },
    ],
  };
}

describe("PlanCardRevisionManager", () => {
  it("creates one card and reuses the same card id for revisions", async () => {
    const createCard = vi.fn().mockResolvedValue("card-1");
    const updateCard = vi.fn().mockResolvedValue(undefined);

    const manager = new PlanCardRevisionManager({
      transport: {
        createCard,
        updateCard,
      },
      toCardUrl: (payload) => `https://example.com/card?v=${payload.version}`,
    });

    const initialCardId = await manager.postInitialPlan("group-1", makePayload(1));
    const revisedCardId = await manager.applyRevision("group-1", makePayload(2));

    expect(initialCardId).toBe("card-1");
    expect(revisedCardId).toBe("card-1");
    expect(createCard).toHaveBeenCalledTimes(1);
    expect(updateCard).toHaveBeenCalledTimes(1);
    expect(updateCard).toHaveBeenCalledWith({
      groupId: "group-1",
      cardId: "card-1",
      payload: {
        url: "https://example.com/card?v=2",
        live: true,
      },
    });
  });

  it("does not create a second card when postInitialPlan is called twice", async () => {
    const createCard = vi.fn().mockResolvedValue("card-1");
    const updateCard = vi.fn().mockResolvedValue(undefined);

    const manager = new PlanCardRevisionManager({
      transport: {
        createCard,
        updateCard,
      },
    });

    const first = await manager.postInitialPlan("group-1", makePayload(1));
    const second = await manager.postInitialPlan("group-1", makePayload(1));

    expect(first).toBe("card-1");
    expect(second).toBe("card-1");
    expect(createCard).toHaveBeenCalledTimes(1);
    expect(updateCard).not.toHaveBeenCalled();
  });

  it("fails revision when no initial card exists", async () => {
    const manager = new PlanCardRevisionManager({
      transport: {
        createCard: vi.fn(),
        updateCard: vi.fn(),
      },
    });

    await expect(manager.applyRevision("group-1", makePayload(2))).rejects.toThrow(
      "No initial card exists for group group-1"
    );
  });
});

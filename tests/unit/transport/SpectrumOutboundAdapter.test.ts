import { describe, expect, it, vi } from "vitest";

import { SpectrumOutboundAdapter } from "../../../src/transport/SpectrumOutboundAdapter.js";

function createMockMessage(id: string) {
  return {
    id,
    platform: "imessage",
    direction: "outbound",
    timestamp: new Date("2026-07-25T12:00:00.000Z"),
  } as any;
}

describe("SpectrumOutboundAdapter", () => {
  it("sends plain text messages via resolved space", async () => {
    const send = vi.fn().mockResolvedValue(createMockMessage("msg-1"));

    const adapter = new SpectrumOutboundAdapter({
      resolveSpace: async () => ({
        id: "group-1",
        send,
      }),
    });

    const sent = await adapter.sendMessage({
      groupId: "group-1",
      text: "hello group",
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("hello group");
    expect(sent).toEqual({
      messageId: "msg-1",
      groupId: "group-1",
      text: "hello group",
      sentAt: new Date("2026-07-25T12:00:00.000Z"),
    });
  });

  it("creates and updates mini-app cards in place", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(createMockMessage("card-1"))
      .mockResolvedValueOnce(undefined);

    const adapter = new SpectrumOutboundAdapter({
      resolveSpace: async () => ({
        id: "group-1",
        send,
      }),
    });

    const cardId = await adapter.createCard({
      groupId: "group-1",
      url: "https://example.com/initial",
      live: true,
    });

    await adapter.updateCard({
      groupId: "group-1",
      cardId,
      payload: {
        url: "https://example.com/updated",
        live: true,
      },
    });

    expect(cardId).toBe("card-1");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects card update when original card handle is unknown", async () => {
    const adapter = new SpectrumOutboundAdapter({
      resolveSpace: async () => ({
        id: "group-1",
        send: vi.fn(),
      }),
    });

    await expect(
      adapter.updateCard({
        groupId: "group-1",
        cardId: "missing-card",
        payload: {
          url: "https://example.com/updated",
        },
      })
    ).rejects.toThrow("card handle not found");
  });

  it("sends poll-style prompts with at least two options", async () => {
    const send = vi.fn().mockResolvedValue(createMockMessage("poll-1"));

    const adapter = new SpectrumOutboundAdapter({
      resolveSpace: async () => ({
        id: "group-1",
        send,
      }),
    });

    await adapter.sendPoll({
      groupId: "group-1",
      title: "Does Saturday work?",
      options: ["Yes", "No"],
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects poll input with fewer than two choices", async () => {
    const adapter = new SpectrumOutboundAdapter({
      resolveSpace: async () => ({
        id: "group-1",
        send: vi.fn(),
      }),
    });

    await expect(
      adapter.sendPoll({
        groupId: "group-1",
        title: "Does Saturday work?",
        options: ["Yes"],
      })
    ).rejects.toThrow("at least two options");
  });
});

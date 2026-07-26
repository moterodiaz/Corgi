import { describe, expect, it, vi } from "vitest";

import { InMemoryTransportPort } from "../../../src/transport/InMemoryTransportPort.js";

describe("InMemoryTransportPort", () => {
  it("delivers inbound messages to registered handlers", async () => {
    const transport = new InMemoryTransportPort();
    const handler = vi.fn();

    transport.onMessage(handler);

    const inboundMessage = {
      messageId: "m-1",
      groupId: "group-1",
      senderId: "user-1",
      text: "hello",
      receivedAt: new Date(),
    };

    await transport.emitMessage(inboundMessage);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(inboundMessage);
  });

  it("stops delivering messages after unsubscribe", async () => {
    const transport = new InMemoryTransportPort();
    const handler = vi.fn();

    const unsubscribe = transport.onMessage(handler);
    unsubscribe();

    await transport.emitMessage({
      messageId: "m-2",
      groupId: "group-1",
      senderId: "user-2",
      text: "ignored",
      receivedAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers card interactions to registered handlers", async () => {
    const transport = new InMemoryTransportPort();
    const handler = vi.fn();

    transport.onCardInteraction(handler);

    const interaction = {
      interactionId: "i-1",
      groupId: "group-1",
      senderId: "user-1",
      action: "suggest-alternative" as const,
      cardId: "card-1",
      note: "too expensive",
      receivedAt: new Date(),
    };

    await transport.emitCardInteraction(interaction);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(interaction);
  });

  it("records sendMessage calls and returns sent metadata", async () => {
    const transport = new InMemoryTransportPort();

    const sent = await transport.sendMessage({
      groupId: "group-1",
      text: "Plan proposal",
    });

    expect(transport.sentMessages).toEqual([
      {
        groupId: "group-1",
        text: "Plan proposal",
      },
    ]);
    expect(sent.messageId).toBe("mem-msg-1");
    expect(sent.groupId).toBe("group-1");
    expect(sent.text).toBe("Plan proposal");
    expect(sent.sentAt).toBeInstanceOf(Date);
  });

  it("records updateCard payloads", async () => {
    const transport = new InMemoryTransportPort();

    await transport.updateCard({
      groupId: "group-1",
      cardId: "card-7",
      payload: {
        version: 2,
        status: "revising",
      },
    });

    expect(transport.cardUpdates).toEqual([
      {
        groupId: "group-1",
        cardId: "card-7",
        payload: {
          version: 2,
          status: "revising",
        },
      },
    ]);
  });
});

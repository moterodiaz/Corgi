import { describe, expect, it, vi } from "vitest";

import {
  FixedWindowRateLimiter,
  SpectrumWebhookInboundAdapter,
  type SpectrumWebhookFunction,
} from "../../../src/transport/SpectrumWebhookInboundAdapter.js";

describe("SpectrumWebhookInboundAdapter", () => {
  it("returns 500 when webhook secret is not configured", async () => {
    const webhook = vi.fn<SpectrumWebhookFunction>().mockResolvedValue({ status: 200 });

    const adapter = new SpectrumWebhookInboundAdapter({
      webhook,
      webhookSecretConfigured: false,
    });

    const response = await adapter.handleWebhook({
      headers: {},
      body: Buffer.from("{}"),
    });

    expect(response.status).toBe(500);
    expect(webhook).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests from same client key", async () => {
    const webhook = vi.fn<SpectrumWebhookFunction>().mockResolvedValue({ status: 200 });

    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      now: () => 1_000,
    });

    const adapter = new SpectrumWebhookInboundAdapter({
      webhook,
      webhookSecretConfigured: true,
      rateLimiter: limiter,
      extractClientKey: () => "same-client",
    });

    const first = await adapter.handleWebhook({
      headers: {},
      body: Buffer.from("{}"),
    });
    const second = await adapter.handleWebhook({
      headers: {},
      body: Buffer.from("{}"),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("dispatches inbound text messages to onMessage handlers", async () => {
    const webhook: SpectrumWebhookFunction = async (_request, handler) => {
      await handler(
        { id: "group-1" },
        {
          id: "msg-1",
          direction: "inbound",
          platform: "imessage",
          sender: { id: "user-1" },
          space: { id: "group-1" },
          timestamp: new Date("2026-07-25T12:00:00.000Z"),
          content: {
            type: "text",
            text: "hello",
          },
        }
      );

      return {
        status: 200,
      };
    };

    const adapter = new SpectrumWebhookInboundAdapter({
      webhook,
      webhookSecretConfigured: true,
    });

    const onMessage = vi.fn();
    adapter.onMessage(onMessage);

    await adapter.handleWebhook({
      headers: {},
      body: Buffer.from("{ \"fixture\": true }"),
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({
      messageId: "msg-1",
      groupId: "group-1",
      senderId: "user-1",
      text: "hello",
      receivedAt: new Date("2026-07-25T12:00:00.000Z"),
    });
  });

  it("dispatches structured card interactions from poll option events", async () => {
    const webhook: SpectrumWebhookFunction = async (_request, handler) => {
      await handler(
        { id: "group-1" },
        {
          id: "int-1",
          direction: "inbound",
          platform: "imessage",
          sender: { id: "user-2" },
          space: { id: "group-1" },
          timestamp: new Date("2026-07-25T12:05:00.000Z"),
          content: {
            type: "poll_option",
            selected: false,
            title: "Saturday 2 PM",
          },
        }
      );

      return {
        status: 200,
      };
    };

    const adapter = new SpectrumWebhookInboundAdapter({
      webhook,
      webhookSecretConfigured: true,
    });

    const onCardInteraction = vi.fn();
    adapter.onCardInteraction(onCardInteraction);

    await adapter.handleWebhook({
      headers: {},
      body: Buffer.from("{ \"fixture\": true }"),
    });

    expect(onCardInteraction).toHaveBeenCalledTimes(1);
    expect(onCardInteraction).toHaveBeenCalledWith({
      interactionId: "int-1",
      groupId: "group-1",
      senderId: "user-2",
      action: "veto",
      note: "Saturday 2 PM",
      receivedAt: new Date("2026-07-25T12:05:00.000Z"),
    });
  });

  it("ignores outbound events from webhook replay", async () => {
    const webhook: SpectrumWebhookFunction = async (_request, handler) => {
      await handler(
        { id: "group-1" },
        {
          id: "msg-2",
          direction: "outbound",
          platform: "imessage",
          sender: { id: "agent" },
          space: { id: "group-1" },
          timestamp: new Date("2026-07-25T12:10:00.000Z"),
          content: {
            type: "text",
            text: "agent echo",
          },
        }
      );

      return {
        status: 200,
      };
    };

    const adapter = new SpectrumWebhookInboundAdapter({
      webhook,
      webhookSecretConfigured: true,
    });

    const onMessage = vi.fn();
    adapter.onMessage(onMessage);

    await adapter.handleWebhook({
      headers: {},
      body: Buffer.from("{ \"fixture\": true }"),
    });

    expect(onMessage).not.toHaveBeenCalled();
  });
});

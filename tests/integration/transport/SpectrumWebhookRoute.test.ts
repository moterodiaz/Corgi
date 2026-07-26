import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../../../src/server.js";
import {
  SpectrumWebhookInboundAdapter,
  type SpectrumWebhookFunction,
} from "../../../src/transport/SpectrumWebhookInboundAdapter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Spectrum webhook route", () => {
  it("returns 500 when webhook secret is not configured", async () => {
    const webhook = vi.fn<SpectrumWebhookFunction>().mockResolvedValue({ status: 200 });

    const adapter = new SpectrumWebhookInboundAdapter({
      webhook,
      webhookSecretConfigured: false,
    });

    const app = createServer({ inboundAdapter: adapter });

    const response = await app.inject({
      method: "POST",
      url: "/spectrum/webhook",
      payload: "{}",
      headers: {
        "content-type": "application/json",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(webhook).not.toHaveBeenCalled();

    await app.close();
  });

  it("forwards verified requests to adapter webhook handler", async () => {
    const webhook = vi.fn<SpectrumWebhookFunction>(async (_request, handler) => {
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
        status: 202,
        headers: {
          "content-type": "application/json",
        },
        body: Buffer.from(JSON.stringify({ ok: true })),
      };
    });

    const adapter = new SpectrumWebhookInboundAdapter({
      webhook,
      webhookSecretConfigured: true,
    });

    const onMessage = vi.fn();
    adapter.onMessage(onMessage);

    const app = createServer({ inboundAdapter: adapter });

    const response = await app.inject({
      method: "POST",
      url: "/spectrum/webhook",
      payload: JSON.stringify({ fixture: true }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(webhook).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);

    await app.close();
  });
});

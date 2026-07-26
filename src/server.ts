import Fastify, { type FastifyInstance } from "fastify";

import {
  type SpectrumWebhookInboundAdapter,
  type SpectrumWebhookRawRequest,
} from "./transport/SpectrumWebhookInboundAdapter.js";

export interface CreateServerOptions {
  inboundAdapter: SpectrumWebhookInboundAdapter;
}

export function createServer(options: CreateServerOptions): FastifyInstance {
  const app = Fastify();

  // Keep raw bytes for webhook signature verification in the adapter layer.
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.post("/spectrum/webhook", async (request, reply) => {
    const rawBody = toBuffer(request.body);

    const adapterRequest: SpectrumWebhookRawRequest = {
      headers: request.headers,
      body: rawBody,
    };

    const result = await options.inboundAdapter.handleWebhook(adapterRequest);

    for (const [key, value] of Object.entries(result.headers)) {
      reply.header(key, value);
    }

    reply.code(result.status).send(result.body);
  });

  return app;
}

function toBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (!body) {
    return Buffer.alloc(0);
  }

  return Buffer.from(JSON.stringify(body));
}

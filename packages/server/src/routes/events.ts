import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ServerContext, SSEClient } from "../services/context.js";

export function createEventsRoute(ctx: ServerContext) {
  const app = new Hono();

  app.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      const client: SSEClient = {
        send: (event) => {
          void stream.writeSSE({
            data: JSON.stringify(event.data),
            event: event.type,
          });
        },
      };

      ctx.sseClients.add(client);

      const heartbeat = setInterval(() => {
        client.send({ type: "heartbeat", data: { timestamp: Date.now() } });
      }, 30_000);

      // Keep stream open until client disconnects; promise resolves on abort
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat);
          ctx.sseClients.delete(client);
          resolve();
        });
      });
    });
  });

  return app;
}

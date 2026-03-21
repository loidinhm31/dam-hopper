import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createEventsRoute } from "../routes/events.js";
import { createTestContext } from "./helpers.js";

describe("events SSE route", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("GET /events responds with 200 and text/event-stream content-type", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createEventsRoute(ctx));

    // Use AbortController to disconnect the SSE stream after checking headers
    const controller = new AbortController();
    const res = await app.request("/events", { signal: controller.signal });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Add and remove a client to verify the set management
    const client = { send: () => {} };
    ctx.sseClients.add(client);
    expect(ctx.sseClients.size).toBeGreaterThan(0);
    ctx.sseClients.delete(client);

    controller.abort();
  });

  it("broadcast sends event to connected SSE clients", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const received: unknown[] = [];
    const client = { send: (event: unknown) => received.push(event) };
    ctx.sseClients.add(client);

    ctx.broadcast({ type: "heartbeat", data: { timestamp: 12345 } });

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("heartbeat");
  });
});

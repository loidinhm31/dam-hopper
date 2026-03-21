import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
  return c.json({ status: "ok", service: "dev-hub-server" });
});

const PORT = Number(process.env.PORT ?? 4800);

// Only start server when executed directly (not when imported for testing)
if (import.meta.url === new URL(process.argv[1], "file://").href) {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`dev-hub server running on http://localhost:${PORT}`);
  });
}

export { app };

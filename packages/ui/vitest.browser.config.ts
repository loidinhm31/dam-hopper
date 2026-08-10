import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const videoFixture = readFileSync(
  fileURLToPath(
    new URL("./browser-tests/fixtures/one-second-vp8.webm", import.meta.url),
  ),
);
const KNOWN_TEST_TICKETS = new Set([
  "playback_ticket",
  "active_ticket",
  "stale_ticket",
  "download_ticket",
]);

const videoFixturePlugin = {
  name: "video-playback-browser-fixture",
  configureServer(server: {
    middlewares: {
      use: (
        path: string,
        handler: (
          request: { url?: string },
          response: {
            statusCode: number;
            setHeader: (name: string, value: string) => void;
            end: (body?: Buffer) => void;
          },
        ) => void,
      ) => void;
    };
  }) {
    server.middlewares.use("/api/fs/video/stream", (request, response) => {
      const ticket = request.url?.split("?")[0]?.replace(/^\//, "");
      if (
        ticket === "unsupported_ticket" ||
        !KNOWN_TEST_TICKETS.has(ticket ?? "")
      ) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "video/webm");
      response.setHeader(
        "Content-Disposition",
        ticket === "download_ticket" ? "attachment" : "inline",
      );
      response.end(videoFixture);
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), videoFixturePlugin],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["@tanstack/react-query", "react", "react-dom"],
  },
  test: {
    include: ["browser-tests/**/*.browser.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
});

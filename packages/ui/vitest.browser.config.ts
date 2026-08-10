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
const imageFixture = readFileSync(
  fileURLToPath(
    new URL("./browser-tests/fixtures/one-pixel.png", import.meta.url),
  ),
);
const KNOWN_TEST_TICKETS = new Set([
  "playback_ticket",
  "active_ticket",
  "stale_ticket",
  "download_ticket",
]);
const imageIssueCounts = new Map<string, number>();

function readJsonBody(
  request: {
    on?: (
      event: "data" | "end",
      listener: (chunk?: Buffer | string) => void,
    ) => void;
  },
  onBody: (body: Record<string, unknown>) => void,
): void {
  let body = "";
  const finish = () => {
    try {
      const parsed = JSON.parse(body);
      onBody(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      onBody({});
    }
  };
  if (!request.on) {
    finish();
    return;
  }
  request.on("data", (chunk) => {
    body += String(chunk ?? "");
  });
  request.on("end", finish);
}

const mediaFixturePlugin = {
  name: "media-preview-browser-fixtures",
  configureServer(server: {
    middlewares: {
      use: (
        path: string,
        handler: (
          request: {
            url?: string;
            method?: string;
            headers?: { authorization?: string };
            on?: (
              event: "data" | "end",
              listener: (chunk?: Buffer | string) => void,
            ) => void;
          },
          response: {
            statusCode: number;
            setHeader: (name: string, value: string) => void;
            end: (body?: Buffer | string) => void;
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
    server.middlewares.use("/api/fs/image/tickets", (request, response) => {
      if (request.headers?.authorization !== "Bearer browser-test-token") {
        response.statusCode = 401;
        response.end();
        return;
      }
      if (request.method === "POST") {
        readJsonBody(request, (body) => {
          const path = typeof body.path === "string" ? body.path : "";
          const issueCount = imageIssueCounts.get(path) ?? 0;
          imageIssueCounts.set(path, issueCount + 1);
          const ticket =
            path === "images/retry.png" && issueCount === 0
              ? "retry_bad_ticket"
              : path === "images/stale-stream.png" && issueCount === 0
                ? "stale_stream_ticket"
                : "image_ticket";
          response.statusCode = 201;
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              ticket,
              streamPath: `/api/fs/image/stream/${ticket}`,
              expiresAt: 1_800_000_000_000,
              purpose: "preview",
            }),
          );
        });
        return;
      }
      if (request.method === "DELETE") {
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 405;
      response.end();
    });
    server.middlewares.use("/api/fs/image/stream", (request, response) => {
      const ticket = request.url?.split("?")[0]?.replace(/^\//, "");
      if (ticket === "retry_bad_ticket") {
        response.statusCode = 404;
        response.end();
        return;
      }
      if (ticket === "stale_stream_ticket") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "image/png");
        response.setHeader("Content-Disposition", "inline");
        setTimeout(() => response.end(imageFixture), 150);
        return;
      }
      if (ticket !== "image_ticket") {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Content-Disposition", "inline");
      response.end(imageFixture);
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), mediaFixturePlugin],
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

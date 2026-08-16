import { existsSync, readFileSync } from "node:fs";
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
const MEDIA_COOKIE = "damhopper-media-session";
const MEDIA_COOKIE_VALUE = "browser-test-media-session";
const KNOWN_TEST_TICKETS = new Set([
  "playback_ticket",
  "active_ticket",
  "stale_ticket",
  "download_ticket",
]);
const imageIssueCounts = new Map<string, number>();
const activeImageTickets = new Set<string>();
// Fixture tickets are intentionally named and reused across browser tests.
// Reference-count them so asynchronous cleanup from an older test cannot
// revoke a newer lease with the same fixture ID.
const activeMediaTickets = new Map(
  [...KNOWN_TEST_TICKETS].map((ticket) => [ticket, 1] as const),
);

function hasMediaCookie(cookieHeader: string | undefined): boolean {
  return (
    cookieHeader
      ?.split(";")
      .some(
        (part) => part.trim() === `${MEDIA_COOKIE}=${MEDIA_COOKIE_VALUE}`,
      ) ?? false
  );
}

function setMediaCookie(response: {
  setHeader: (name: string, value: string) => void;
}): void {
  response.setHeader(
    "Set-Cookie",
    `${MEDIA_COOKIE}=${MEDIA_COOKIE_VALUE}; HttpOnly; SameSite=Lax; Path=/api/fs`,
  );
}

function clearMediaCookie(response: {
  setHeader: (name: string, value: string) => void;
}): void {
  response.setHeader(
    "Set-Cookie",
    `${MEDIA_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/fs; Max-Age=0`,
  );
}
const requestedBrowserChannel = process.env.BROWSER_CHANNEL?.trim();
const requestedExecutablePath = process.env.BROWSER_EXECUTABLE_PATH?.trim();
if (requestedBrowserChannel && requestedExecutablePath) {
  throw new Error("Set only one of BROWSER_CHANNEL or BROWSER_EXECUTABLE_PATH");
}
if (requestedExecutablePath && !existsSync(requestedExecutablePath)) {
  throw new Error(
    `BROWSER_EXECUTABLE_PATH does not exist: ${requestedExecutablePath}`,
  );
}
const systemChromiumPath = [
  requestedExecutablePath,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].find((candidate): candidate is string =>
  Boolean(candidate && existsSync(candidate)),
);
const browserLaunchOptions = requestedBrowserChannel
  ? { channel: requestedBrowserChannel }
  : systemChromiumPath
    ? { executablePath: systemChromiumPath }
    : {};

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
            headers?: {
              authorization?: string;
              cookie?: string;
              origin?: string;
              host?: string;
            };
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
    server.middlewares.use("/api/fs/video/tickets", (request, response) => {
      if (request.headers?.authorization !== "Bearer synthetic-auth") {
        response.statusCode = 401;
        response.end();
        return;
      }
      if (request.method === "POST") {
        readJsonBody(request, (body) => {
          const purpose = body.purpose === "download" ? "download" : "playback";
          const ticket =
            body.path === "clips/unsupported.webm"
              ? "unsupported_ticket"
              : purpose === "download"
                ? "download_ticket"
                : body.path === "clips/active.webm"
                  ? "active_ticket"
                  : body.path === "clips/stale.webm"
                    ? "stale_ticket"
                    : "playback_ticket";
          activeMediaTickets.set(
            ticket,
            (activeMediaTickets.get(ticket) ?? 0) + 1,
          );
          response.statusCode = 201;
          response.setHeader("Cache-Control", "no-store");
          setMediaCookie(response);
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              ticket,
              streamPath: `/api/fs/video/stream/${ticket}`,
              expiresAt: 1_800_000_000_000,
              purpose,
              authorizationMode: "session-cookie-v1",
            }),
          );
        });
        return;
      }
      if (request.method === "DELETE") {
        readJsonBody(request, (body) => {
          if (typeof body.ticket === "string") {
            const references = activeMediaTickets.get(body.ticket) ?? 0;
            if (references <= 1) activeMediaTickets.delete(body.ticket);
            else activeMediaTickets.set(body.ticket, references - 1);
          }
          response.statusCode = 204;
          response.end();
        });
        return;
      }
      response.statusCode = 405;
      response.end();
    });
    server.middlewares.use("/api/fs/media-session", (request, response) => {
      if (
        request.headers?.authorization !== "Bearer browser-test-token" &&
        request.headers?.authorization !== "Bearer synthetic-auth"
      ) {
        response.statusCode = 401;
        response.end();
        return;
      }
      if (request.method === "DELETE") {
        response.statusCode = 204;
        clearMediaCookie(response);
        response.end();
        return;
      }
      response.statusCode = 405;
      response.end();
    });
    server.middlewares.use("/api/fs/video/stream", (request, response) => {
      const ticket = request.url?.split("?")[0]?.split("/").pop();
      if (
        !hasMediaCookie(request.headers?.cookie) ||
        ticket === "unsupported_ticket" ||
        (activeMediaTickets.get(ticket ?? "") ?? 0) === 0
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
                : `image_ticket${issueCount ? `_${issueCount + 1}` : ""}`;
          activeImageTickets.add(ticket);
          response.statusCode = 201;
          response.setHeader("Cache-Control", "no-store");
          setMediaCookie(response);
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              ticket,
              streamPath: `/api/fs/image/stream/${ticket}`,
              expiresAt: 1_800_000_000_000,
              purpose: "preview",
              authorizationMode: "session-cookie-v1",
            }),
          );
        });
        return;
      }
      if (request.method === "DELETE") {
        readJsonBody(request, (body) => {
          if (typeof body.ticket === "string")
            activeImageTickets.delete(body.ticket);
          response.statusCode = 204;
          response.end();
        });
        return;
      }
      response.statusCode = 405;
      response.end();
    });
    server.middlewares.use("/api/fs/image/stream", (request, response) => {
      const ticket = request.url?.split("?")[0]?.split("/").pop();
      if (!hasMediaCookie(request.headers?.cookie)) {
        response.statusCode = 404;
        response.end();
        return;
      }
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
      if (!ticket || !activeImageTickets.has(ticket)) {
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
    // Browser suites share the Vite media fixture server and Chromium has a
    // finite resource budget. Serial files keep native media readiness checks
    // deterministic when the full suite is run.
    fileParallelism: false,
    include: ["browser-tests/**/*.browser.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: browserLaunchOptions }),
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
});

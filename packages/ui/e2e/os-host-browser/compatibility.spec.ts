import { test, expect, chromium } from "@playwright/test";
import * as http from "node:http";
import type { Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import {
  prebuildQualificationExample,
  launchQualificationServer,
  type QualificationServerInfo,
} from "../fixtures/browser-host-qualification.js";

/** Raw HTTP request; resolves with status (101 for an accepted upgrade, plus its socket). */
function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string | string[]>,
  upgrade: boolean,
): Promise<{ status: number; socket?: Socket }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ status: number; socket?: Socket }>();
  const req = http.request({
    host: "127.0.0.1",
    port,
    path,
    headers: upgrade
      ? {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
          ...headers,
        }
      : headers,
  });
  req.on("response", (res) => {
    res.resume();
    resolve({ status: res.statusCode ?? 0 });
  });
  req.on("upgrade", (_res, socket) => resolve({ status: 101, socket }));
  req.on("error", reject);
  req.end();
  return promise;
}

test.describe("Host Browser Engine Qualification — CDP and Auth Compatibility", () => {
  let serverInfo: QualificationServerInfo;
  const testToken = "qual-secret-bearer-token-123";

  test.beforeAll(async () => {
    test.setTimeout(660_000);
    const executablePath = await prebuildQualificationExample();
    serverInfo = await launchQualificationServer(executablePath, testToken);
  });

  test.afterAll(async () => {
    if (serverInfo) {
      await serverInfo.cleanup();
    }
  });

  test.beforeEach(async () => {
    // Reset auth observation flags before each test
    const resetRes = await fetch(`${serverInfo.httpUrl}/api/qualification/reset`, { method: "POST" });
    expect(resetRes.ok).toBe(true);
  });

  test("rejects unauthenticated discovery request with HTTP 401", async () => {
    const resp = await fetch(`${serverInfo.httpUrl}/json/version`);
    expect(resp.status).toBe(401);
  });

  test("rejects unauthenticated WebSocket upgrade with HTTP 401", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<number>();

    const req = http.request({
      host: "127.0.0.1",
      port: serverInfo.port,
      path: "/cdp",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });

    req.on("response", (res) => {
      resolve(res.statusCode ?? 0);
    });

    req.on("upgrade", () => {
      reject(new Error("unauthenticated WS upgrade should not succeed"));
    });

    req.on("error", (err: unknown) => {
      reject(err);
    });

    req.end();

    const statusCode = await promise;
    expect(statusCode).toBe(401);
  });

  test("accepts authenticated discovery request with Bearer token", async () => {
    // Note: /json/version returns fixture discovery metadata pointing to the qualification WS proxy.
    // Real-engine CDP execution is proved in the connectOverCDP test below.
    const resp = await fetch(`${serverInfo.httpUrl}/json/version`, {
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.Browser).toContain("Chrome");
    expect(body.webSocketDebuggerUrl).toBe(`${serverInfo.wsUrl}`);
  });

  test("proves Playwright connectOverCDP transmits Authorization header to BOTH discovery and WS", async () => {
    // 1. Explicitly verify clean state before connecting
    const preRes = await fetch(`${serverInfo.httpUrl}/api/qualification/status`);
    expect(preRes.ok).toBe(true);
    const preStatus = await preRes.json();
    expect(preStatus.discoveryAuthReceived).toBe(false);
    expect(preStatus.wsAuthReceived).toBe(false);

    // 2. Connect over CDP with Authorization header
    const browser = await chromium.connectOverCDP(serverInfo.httpUrl, {
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
    });

    try {
      const contexts = browser.contexts();
      expect(contexts.length).toBeGreaterThan(0);
      const page = contexts[0].pages()[0] ?? (await contexts[0].newPage());

      // 3. Execute real page evaluate through the proxied CDP connection
      const evaluated = await page.evaluate(() => 21 * 2);
      expect(evaluated).toBe(42);

      // 4. Verify server received Authorization on BOTH discovery and WebSocket upgrade
      const resp = await fetch(`${serverInfo.httpUrl}/api/qualification/status`);
      expect(resp.status).toBe(200);
      const status = await resp.json();

      expect(status.discoveryAuthReceived).toBe(true);
      expect(status.wsAuthReceived).toBe(true);
      expect(status.bothAuthReceived).toBe(true);
    } finally {
      await browser.close();
    }
  });

  test("enforces exact Origin on discovery and WS upgrade even with a valid bearer", async () => {
    const auth = { Authorization: `Bearer ${testToken}` };
    const approved = serverInfo.httpUrl;

    for (const badOrigin of ["http://evil.example", "null", `${approved}/`, approved.toUpperCase()]) {
      const discovery = await rawRequest(serverInfo.port, "/json/version", { ...auth, Origin: badOrigin }, false);
      expect(discovery.status, `discovery Origin ${badOrigin}`).toBe(403);
      const ws = await rawRequest(serverInfo.port, "/cdp", { ...auth, Origin: badOrigin }, true);
      expect(ws.status, `ws Origin ${badOrigin}`).toBe(403);
    }

    // Origin-less (header-authenticated native/agent) and the exact approved Origin pass.
    expect((await rawRequest(serverInfo.port, "/json/version", auth, false)).status).toBe(200);
    expect((await rawRequest(serverInfo.port, "/json/version", { ...auth, Origin: approved }, false)).status).toBe(200);
    const ok = await rawRequest(serverInfo.port, "/cdp", { ...auth, Origin: approved }, true);
    expect(ok.status).toBe(101);
    ok.socket?.destroy();

    // A bad Origin without a bearer remains an authentication failure, not an Origin oracle.
    expect((await rawRequest(serverInfo.port, "/json/version", { Origin: "http://evil.example" }, false)).status).toBe(401);
  });

  test("rejects a repeated Origin header even when both values are the approved Origin", async () => {
    const auth = { Authorization: `Bearer ${testToken}` };
    const twice = [serverInfo.httpUrl, serverInfo.httpUrl];
    expect((await rawRequest(serverInfo.port, "/json/version", { ...auth, Origin: twice }, false)).status).toBe(403);
    expect((await rawRequest(serverInfo.port, "/cdp", { ...auth, Origin: twice }, true)).status).toBe(403);
  });

  test("closes the relay when an upstream browser reply exceeds the 4 MiB bound", async () => {
    const browser = await chromium.connectOverCDP(serverInfo.httpUrl, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    try {
      const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage());
      // The CDP reply carrying this 5 MiB string is one upstream message above the relay bound.
      const outcome = await Promise.race([
        page.evaluate(() => "x".repeat(5 * 1024 * 1024)).then(
          () => "delivered",
          () => "rejected",
        ),
        sleep(15_000, "hung"),
      ]);
      expect(outcome).toBe("rejected");
    } finally {
      await browser.close().catch(() => {});
    }
  });

  test("closes the relay when a client frame exceeds the 4 MiB bound", async () => {
    const upgraded = await rawRequest(serverInfo.port, "/cdp", { Authorization: `Bearer ${testToken}` }, true);
    expect(upgraded.status).toBe(101);
    const socket = upgraded.socket!;
    const { promise: closed, resolve: markClosed } = Promise.withResolvers<void>();
    socket.on("error", () => {});
    socket.on("close", () => markClosed());

    // Masked text frame (zero mask key) declaring a 5 MiB payload.
    const payloadLen = 5 * 1024 * 1024;
    const header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadLen), 2);
    socket.write(Buffer.concat([header, Buffer.alloc(payloadLen, 0x61)]));

    const outcome = await Promise.race([
      closed.then(() => "closed"),
      sleep(5_000, "still-open"),
    ]);
    socket.destroy();
    expect(outcome).toBe("closed");

    // The fixture itself stays healthy after dropping the abusive connection.
    const status = await fetch(`${serverInfo.httpUrl}/api/qualification/status`);
    expect(status.ok).toBe(true);
  });
});

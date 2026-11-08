import { test, expect, chromium } from "@playwright/test";
import * as http from "node:http";
import type { Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import {
  prebuildQualificationExample,
  launchQualificationServer,
  isProcessAlive,
  checkPgidProcesses,
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

/** Formats a masked client text WebSocket frame. */
function encodeWsText(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81;
    header[1] = 0x80 | len;
    header.writeUInt32BE(0x12345678, 2);
  } else if (len <= 65535) {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    header.writeUInt32BE(0x12345678, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    header.writeUInt32BE(0x12345678, 10);
  }
  const mask = header.subarray(header.length - 4);
  const maskedPayload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    maskedPayload[i] = payload[i] ^ mask[i % 4];
  }
  return Buffer.concat([header, maskedPayload]);
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
    // Ensure the fixture is healthy before each test
    serverInfo.assertHealthy();
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

  test("accepts authenticated discovery request with Bearer token and reflects real engine metadata", async () => {
    const resp = await fetch(`${serverInfo.httpUrl}/json/version`, {
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
    });

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.Browser).toMatch(/Chrome\/\d+\.\d+\.\d+\.\d+/);
    expect(body["Protocol-Version"]).toBe("1.3");
    expect(body["V8-Version"]).toBeDefined();
    expect(body.webSocketDebuggerUrl).toBe(serverInfo.wsUrl);

    // Verify /json/list reflects real targets from the browser
    const listResp = await fetch(`${serverInfo.httpUrl}/json/list`, {
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
    });
    expect(listResp.status).toBe(200);
    const targets = await listResp.json();
    expect(Array.isArray(targets)).toBe(true);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.id).toBeDefined();
      expect(t.type).toBeDefined();
      expect(t.webSocketDebuggerUrl).toContain(String(serverInfo.port));
    }
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

  test("rejects a comma-separated duplicate Origin header even when both values are the approved Origin", async () => {
    const auth = { Authorization: `Bearer ${testToken}` };
    const commaDuplicate = `${serverInfo.httpUrl}, ${serverInfo.httpUrl}`;
    expect((await rawRequest(serverInfo.port, "/json/version", { ...auth, Origin: commaDuplicate }, false)).status).toBe(403);
    expect((await rawRequest(serverInfo.port, "/cdp", { ...auth, Origin: commaDuplicate }, true)).status).toBe(403);
  });

  test("enforces 2-connection concurrent limit on agent relay sockets and rejects 3rd with 429", async () => {
    const auth = { Authorization: `Bearer ${testToken}` };

    const conn1 = await rawRequest(serverInfo.port, "/cdp", auth, true);
    expect(conn1.status).toBe(101);
    expect(conn1.socket).toBeDefined();

    const conn2 = await rawRequest(serverInfo.port, "/cdp", auth, true);
    expect(conn2.status).toBe(101);
    expect(conn2.socket).toBeDefined();

    try {
      // 3rd concurrent connection must be rejected with 429 Too Many Requests
      const conn3 = await rawRequest(serverInfo.port, "/cdp", auth, true);
      expect(conn3.status).toBe(429);
      if (conn3.socket) conn3.socket.destroy();

      // Close connection 1 to free a permit
      conn1.socket?.destroy();
      await sleep(150);

      // Now a replacement connection succeeds with 101
      const conn4 = await rawRequest(serverInfo.port, "/cdp", auth, true);
      expect(conn4.status).toBe(101);
      if (conn4.socket) conn4.socket.destroy();
    } finally {
      conn1.socket?.destroy();
      conn2.socket?.destroy();
    }
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
      await sleep(500);
      expect(browser.isConnected()).toBe(false);

      // An oversize teardown is not a write-deadline timeout
      const statusResp = await fetch(`${serverInfo.httpUrl}/api/qualification/status`);
      const status = await statusResp.json();
      expect(status.clientWriteDeadlineTimeouts).toBe(0);
      expect(status.upstreamWriteDeadlineTimeouts).toBe(0);
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
    const statusResp = await fetch(`${serverInfo.httpUrl}/api/qualification/status`);
    expect(statusResp.ok).toBe(true);
    const status = await statusResp.json();
    expect(status.clientWriteDeadlineTimeouts).toBe(0);
    expect(status.upstreamWriteDeadlineTimeouts).toBe(0);
  });

  test("closes the relay when client read stalls past the 5-second write deadline", async () => {
    const intStatus = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`).then((r) => r.json());
    expect(intStatus.active).toBe(true);
    const targetId = intStatus.targetId;

    const upgraded = await rawRequest(serverInfo.port, `/cdp/${targetId}`, { Authorization: `Bearer ${testToken}` }, true);
    expect(upgraded.status).toBe(101);
    const socket = upgraded.socket!;

    const { promise: closed, resolve: markClosed } = Promise.withResolvers<void>();
    socket.on("error", () => {});
    socket.on("close", () => markClosed());

    // Pause client socket reads to induce write backpressure on the server relay
    socket.pause();

    // Send multiple evaluations (~250 KiB response each) to saturate loopback TCP buffer
    for (let i = 1; i <= 35; i++) {
      const cmd = JSON.stringify({
        id: i,
        method: "Runtime.evaluate",
        params: { expression: `'stalled_chunk_data_'.repeat(15000)` },
      });
      socket.write(encodeWsText(cmd));
    }

    // Server relay enforces a 5-second write deadline. Wait 6 seconds for backpressure to stall
    // forwarding and trigger write deadline expiry on the server.
    await sleep(6_000);

    // Resume socket reads so Node drains remaining buffered frames and receives server's close
    socket.resume();

    const outcome = await Promise.race([
      closed.then(() => "closed"),
      sleep(6_000, "still-open"),
    ]);

    socket.destroy();
    expect(outcome).toBe("closed");

    // Verify fixture recorded write deadline teardown specifically
    const statusResp = await fetch(`${serverInfo.httpUrl}/api/qualification/status`);
    expect(statusResp.ok).toBe(true);
    const status = await statusResp.json();
    expect(status.clientWriteDeadlineTimeouts).toBeGreaterThanOrEqual(1);
    expect(status.upstreamWriteDeadlineTimeouts).toBe(0);

    // Verify the connection permit was freed so a new connection succeeds immediately
    const nextConn = await rawRequest(serverInfo.port, "/cdp", { Authorization: `Bearer ${testToken}` }, true);
    expect(nextConn.status).toBe(101);
    nextConn.socket?.destroy();
  });

  test("proves simultaneous internal actor Page screencast session and independent Playwright agent session without interference", async () => {
    // 1. Verify internal actor session is actively receiving frames on target A
    const intStatusPre = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`).then((r) => r.json());
    expect(intStatusPre.active).toBe(true);
    expect(intStatusPre.targetId).toBeDefined();
    const initialFrames = intStatusPre.framesReceived;
    expect(intStatusPre.terminalError).toBeNull();

    // 2. Connect independent Playwright agent session to the relay
    const agentBrowser = await chromium.connectOverCDP(serverInfo.httpUrl, {
      headers: { Authorization: `Bearer ${testToken}` },
    });

    try {
      const agentContext = await agentBrowser.newContext();
      const agentPage = await agentContext.newPage();

      // 3. Agent navigates and interacts with its OWN target B
      await agentPage.goto("data:text/html,<html><body><h1 id='agent-title'>Independent Agent Target</h1></body></html>");
      const title = await agentPage.textContent("#agent-title");
      expect(title).toBe("Independent Agent Target");

      // 4. Drive visual updates on internal target A while agent evaluates on target B
      await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session/poke`, { method: "POST" });
      await sleep(300);

      const evalResult = await agentPage.evaluate(() => 2 + 2);
      expect(evalResult).toBe(4);

      // 5. Verify internal target A continued receiving screencast frames without interference
      const intStatusPost = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`).then((r) => r.json());
      expect(intStatusPost.framesReceived).toBeGreaterThan(initialFrames);
      expect(intStatusPost.terminalError).toBeNull();
      expect(intStatusPost.targetId).toBe(intStatusPre.targetId);

      // 6. Verify agent page on target B remains completely functional
      const bodyText = await agentPage.textContent("body");
      expect(bodyText).toContain("Independent Agent Target");
    } finally {
      await agentBrowser.close();
    }

    // 7. After agent disconnects, internal session remains healthy
    const intStatusFinal = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`).then((r) => r.json());
    expect(intStatusFinal.terminalError).toBeNull();
  });

  test("terminates the entire process tree and reports failure when post-readiness output overflows", async () => {
    const executablePath = await prebuildQualificationExample();
    const overflowServer = await launchQualificationServer(executablePath, "overflow-token-test");
    try {
      expect(overflowServer.qualificationReady).toBe(true);
      const childPid = overflowServer.childPid!;
      const browserPid = overflowServer.browserPid;
      expect(childPid).toBeGreaterThan(0);
      expect(browserPid).toBeGreaterThan(0);

      // Trigger output flood > 10 MiB via POST /api/qualification/flood_output
      await fetch(`${overflowServer.httpUrl}/api/qualification/flood_output`, { method: "POST" });

      // Await failure promise
      const failureErr = await Promise.race([
        overflowServer.failurePromise,
        sleep(8_000, "hung").then(() => {
          throw new Error("timed out waiting for overflow teardown");
        }),
      ]);
      expect(failureErr.message).toContain("stdout exceeded");
      expect(failureErr.message).not.toContain("cleanup failure");
      expect(failureErr.message).not.toContain("cleanup unproven");

      // Verify assertHealthy() throws with the pure overflow cause
      expect(() => overflowServer.assertHealthy()).toThrow(/stdout exceeded/);
      try {
        overflowServer.assertHealthy();
        throw new Error("expected assertHealthy to throw");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toContain("stdout exceeded");
        expect(msg).not.toContain("cleanup failure");
        expect(msg).not.toContain("cleanup unproven");
      }

      // Bounded wait asserting whole process group of child AND browserPid are empty
      const deadline = Date.now() + 5000;
      let childGroup: number[] = [childPid];
      let browserGroup: number[] = [browserPid];

      while (Date.now() < deadline) {
        childGroup = await checkPgidProcesses(childPid);
        browserGroup = await checkPgidProcesses(browserPid);
        if (
          childGroup.length === 0 &&
          browserGroup.length === 0 &&
          !isProcessAlive(childPid) &&
          !isProcessAlive(browserPid)
        ) {
          break;
        }
        await sleep(50);
      }

      expect(childGroup).toEqual([]);
      expect(browserGroup).toEqual([]);
      expect(isProcessAlive(childPid)).toBe(false);
      expect(isProcessAlive(browserPid)).toBe(false);
    } finally {
      // Cleanup must succeed idempotently without error swallow
      await overflowServer.cleanup();
    }
  });
});

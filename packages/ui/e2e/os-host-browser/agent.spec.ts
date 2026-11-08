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

test.describe("Host Browser Production CDP Gateway — Agent Interoperability Qualification", () => {
  let serverInfo: QualificationServerInfo;

  test.beforeAll(async () => {
    test.setTimeout(660_000);
    const executablePath = await prebuildQualificationExample();
    serverInfo = await launchQualificationServer(executablePath, {
      mode: "production-gateway",
    });
  });

  test.afterAll(async () => {
    if (serverInfo) {
      await serverInfo.cleanup();
    }
  });

  test.beforeEach(async () => {
    serverInfo.assertHealthy();
  });

  test("rejects unauthenticated discovery request with HTTP 401 and no-store", async () => {
    const resp = await fetch(`${serverInfo.httpUrl}/api/browser/cdp/json/version`);
    expect(resp.status).toBe(401);
    expect(resp.headers.get("cache-control")).toContain("no-store");
  });

  test("rejects discovery with unapproved Origin even with valid bearer", async () => {
    const authHeaders = { Authorization: `Bearer ${serverInfo.expectedToken}` };
    const badOriginRes = await rawRequest(serverInfo.port, "/api/browser/cdp/json/version", {
      ...authHeaders,
      Origin: "http://evil.example",
    }, false);
    expect(badOriginRes.status).toBe(403);
  });

  test("rejects WebSocket upgrade with unapproved Origin even with valid bearer", async () => {
    const authHeaders = { Authorization: `Bearer ${serverInfo.expectedToken}` };
    const badWs = await rawRequest(serverInfo.port, "/api/browser/cdp/ws", {
      ...authHeaders,
      Origin: "http://evil.example",
    }, true);
    expect(badWs.status).toBe(403);
  });

  test("accepts discovery with valid bearer and rewrites webSocketDebuggerUrl to gateway", async () => {
    const resp = await fetch(`${serverInfo.httpUrl}/api/browser/cdp/json/version`, {
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
      },
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("cache-control")).toContain("no-store");
    const data = await resp.json();
    expect(data.webSocketDebuggerUrl).toBe(`ws://127.0.0.1:${serverInfo.port}/api/browser/cdp/ws`);
    expect(JSON.stringify(data)).not.toContain(`ws://127.0.0.1:${serverInfo.port}/devtools/`);
  });

  test("proves Playwright connectOverCDP connects to production gateway using Bearer on both paths and mutates target", async () => {
    const browser = await chromium.connectOverCDP(`${serverInfo.httpUrl}/api/browser/cdp`, {
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
      },
    });

    try {
      const contexts = browser.contexts();
      expect(contexts.length).toBeGreaterThan(0);
      const page = contexts[0].pages()[0] ?? (await contexts[0].newPage());

      await page.setContent("<h1 id='title'>Production Gateway Agent Test</h1>");
      const titleText = await page.textContent("#title");
      expect(titleText).toBe("Production Gateway Agent Test");

      const pokeRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session/poke`, {
        method: "POST",
      });
      expect(pokeRes.ok).toBe(true);

      const statusRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`);
      expect(statusRes.ok).toBe(true);
      const statusData = await statusRes.json();
      expect(statusData.active).toBe(true);
      expect(statusData.framesReceived).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  });

  test("proves agent Page.disable or stopScreencast cannot stop the independent native session", async () => {
    const browser = await chromium.connectOverCDP(`${serverInfo.httpUrl}/api/browser/cdp`, {
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
      },
    });

    try {
      const context = browser.contexts()[0];
      const page = context.pages()[0] ?? (await context.newPage());
      const cdpSession = await context.newCDPSession(page);

      try {
        await cdpSession.send("Page.stopScreencast");
        await cdpSession.send("Page.disable");
      } catch {
        // Ignored if not supported
      }

      await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session/poke`, { method: "POST" });
      await sleep(100);

      const statusRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`);
      const statusData = await statusRes.json();
      expect(statusData.active).toBe(true);
      expect(statusData.terminalError).toBeNull();
    } finally {
      await browser.close();
    }
  });

  test("proves revocation of one agent login closes its connection while sibling session persists", async () => {
    if (!serverInfo.siblingToken) {
      test.skip();
      return;
    }

    const agentPrimary = await chromium.connectOverCDP(`${serverInfo.httpUrl}/api/browser/cdp`, {
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
      },
    });

    const agentSibling = await chromium.connectOverCDP(`${serverInfo.httpUrl}/api/browser/cdp`, {
      headers: {
        Authorization: `Bearer ${serverInfo.siblingToken}`,
      },
    });

    try {
      expect(agentPrimary.isConnected()).toBe(true);
      expect(agentSibling.isConnected()).toBe(true);

      const revokeRes = await fetch(`${serverInfo.httpUrl}/api/qualification/revoke_session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "admin-session-2" }),
      });
      expect(revokeRes.ok).toBe(true);

      let siblingClosed = false;
      const deadline = Date.now() + 7000;
      while (Date.now() < deadline) {
        if (!agentSibling.isConnected()) {
          siblingClosed = true;
          break;
        }
        await sleep(500);
      }
      expect(siblingClosed, "sibling session should be closed upon revocation").toBe(true);

      expect(agentPrimary.isConnected()).toBe(true);
      const page = agentPrimary.contexts()[0].pages()[0];
      if (page) {
        await page.evaluate(() => 1 + 1);
      }
    } finally {
      if (agentPrimary.isConnected()) {
        await agentPrimary.close();
      }
      if (agentSibling.isConnected()) {
        await agentSibling.close();
      }
    }
  });
});

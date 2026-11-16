import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
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

/** Finds the Playwright Page whose CDP Target ID strictly equals the expected ID without fallback. */
async function findPageByExactTargetId(browser: Browser, expectedTargetId: string): Promise<Page> {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const pageSession = await context.newCDPSession(page);
      const { targetInfo } = await pageSession.send("Target.getTargetInfo");
      if (targetInfo.targetId === expectedTargetId) {
        return page;
      }
    }
  }
  throw new Error(`Exact target ${expectedTargetId} not found among Playwright pages`);
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
  test("rejects Origin-less capability-only upgrade even with a valid ticket", async () => {
    // 1. Create a managed session to anchor the ticket
    const createSessionRes = await fetch(`${serverInfo.httpUrl}/api/browser/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creationKey: "11111111-2222-3333-4444-555555555555",
        url: "http://example.com",
        viewport: { width: 800, height: 600, dpr: 1 },
      }),
    });
    expect(createSessionRes.ok).toBe(true);
    const sessionData = await createSessionRes.json();

    // 2. Issue a genuine server-derived capability ticket
    const ticketRes = await fetch(`${serverInfo.httpUrl}/api/browser/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        purpose: "agentCdp",
        browserSessionId: sessionData.browserSessionId,
        browserIncarnation: sessionData.browserIncarnation,
        profileEpoch: String(sessionData.profileEpoch),
      }),
    });
    expect(ticketRes.ok).toBe(true);
    const { ticket } = await ticketRes.json();

    // 3. Attempt WebSocket upgrade with valid ticket but NO Origin and NO Bearer
    const capRes = await rawRequest(
      serverInfo.port,
      "/api/browser/cdp/ws",
      {
        "Sec-WebSocket-Protocol": `damhopper.ticket.${ticket}`,
      },
      true,
    );
    expect(capRes.status).toBe(403);
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
    const statusResPre = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`);
    expect(statusResPre.ok).toBe(true);
    const statusPre = await statusResPre.json();
    const expectedTargetId = statusPre.targetId;
    const initialFrames = statusPre.framesReceived;

    const browser = await chromium.connectOverCDP(`${serverInfo.httpUrl}/api/browser/cdp`, {
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
      },
    });

    try {
      // Select the exact page by target ID equality with fixture's ID
      const page = await findPageByExactTargetId(browser, expectedTargetId);

      const uniqueMarker = `Marker-${Date.now()}`;
      await page.evaluate((marker) => {
        document.title = marker;
        document.body.innerHTML = `<h1 id='title'>${marker}</h1>`;
      }, uniqueMarker);

      const titleText = await page.textContent("#title");
      expect(titleText).toBe(uniqueMarker);

      // Verify the independent native session reads the EXACT same DOM marker back
      const evalRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session/eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: "document.title" }),
      });
      expect(evalRes.ok).toBe(true);
      const evalData = await evalRes.json();
      expect(evalData?.result?.value).toBe(uniqueMarker);

      const pokeRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session/poke`, {
        method: "POST",
      });
      expect(pokeRes.ok).toBe(true);

      // Poll for strictly increased frame counter on the native screencast session
      let framesAdvanced = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const statusRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          if (data.framesReceived > initialFrames) {
            framesAdvanced = true;
            break;
          }
        }
        await sleep(200);
      }
      expect(framesAdvanced, "native screencast session must receive new frames after mutation").toBe(true);
    } finally {
      await browser.close();
    }
  });

  test("proves agent Page.disable or stopScreencast cannot stop the independent native session", async () => {
    const statusResPre = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`);
    expect(statusResPre.ok).toBe(true);
    const statusPre = await statusResPre.json();
    const expectedTargetId = statusPre.targetId;

    const browser = await chromium.connectOverCDP(`${serverInfo.httpUrl}/api/browser/cdp`, {
      headers: {
        Authorization: `Bearer ${serverInfo.expectedToken}`,
      },
    });

    try {
      // Select the exact page by target ID equality with fixture's ID
      const page = await findPageByExactTargetId(browser, expectedTargetId);
      const context = page.context();
      const cdpSession = await context.newCDPSession(page);

      // Execute commands without suppressing errors
      await cdpSession.send("Page.stopScreencast");
      await cdpSession.send("Page.disable");

      // Establish baseline strictly AFTER interfering commands execute
      const postCmdRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`);
      expect(postCmdRes.ok).toBe(true);
      const postCmdData = await postCmdRes.json();
      const baselineFrames = postCmdData.framesReceived;

      const pokeRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session/poke`, { method: "POST" });
      expect(pokeRes.ok).toBe(true);

      let framesAdvanced = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const statusRes = await fetch(`${serverInfo.httpUrl}/api/qualification/internal_session`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          expect(data.terminalError).toBeNull();
          expect(data.active).toBe(true);
          if (data.framesReceived > baselineFrames) {
            framesAdvanced = true;
            break;
          }
        }
        await sleep(200);
      }
      expect(framesAdvanced, "independent screencast must continue advancing frames despite agent disable/stop").toBe(true);
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

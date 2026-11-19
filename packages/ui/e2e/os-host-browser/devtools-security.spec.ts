import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createBrowserStorageState } from "../fixtures/application-storage-state.js";
import { startHostBrowserAppServer, type HostBrowserAppServer } from "../fixtures/host-browser-app.js";
import {
  createJourneyPage,
  disposeJourney,
  expectJourneyCanvas,
} from "../fixtures/host-browser-journey-driver.js";

interface BrowserWindowView {
  app: Locator;
  frame: Locator;
  canvas: Locator;
  sessionId: string;
}

/**
 * Evaluates an expression inside a target Chromium page using DamHopper's privileged raw CDP
 * gateway (/api/browser/cdp/ws/{targetId}) directly, without Playwright's connectOverCDP
 * sending its own Browser.setDownloadBehavior override.
 */
async function rawCdpEval<T = unknown>(
  page: Page,
  host: HostBrowserAppServer,
  urlSubstring: string,
  expression: string,
): Promise<T> {
  return await page.evaluate(
    async ({ origin, authToken, urlSub, expr }) => {
      const sessRes = await fetch(`${origin}/api/browser/sessions`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!sessRes.ok) throw new Error(`sessions ${sessRes.status}`);
      const sessions = (await sessRes.json()) as {
        browserIncarnation: string;
        profileEpoch: string;
      }[];
      const activeSession = sessions[0];
      if (!activeSession) throw new Error("no active browser session for rawCdpEval");

      const listRes = await fetch(`${origin}/api/browser/cdp/json/list`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!listRes.ok) throw new Error(`json/list ${listRes.status}`);
      const targets = (await listRes.json()) as { id: string; type: string; url: string }[];
      const target = targets.find((t) => t.type === "page" && t.url.includes(urlSub));
      if (!target) {
        throw new Error(`target matching ${urlSub} not found in ${JSON.stringify(targets.map((t) => t.url))}`);
      }

      const ticketRes = await fetch(`${origin}/api/browser/attachments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purpose: "agentCdp",
          browserIncarnation: activeSession.browserIncarnation,
          profileEpoch: activeSession.profileEpoch,
        }),
      });
      if (!ticketRes.ok) throw new Error(`agentCdp ticket ${ticketRes.status}`);
      const { ticket } = (await ticketRes.json()) as { ticket: string };

      const wsUrl = `${origin.replace(/^http/, "ws")}/api/browser/cdp/ws/${encodeURIComponent(target.id)}`;
      return await new Promise<T>((resolve, reject) => {
        const ws = new WebSocket(wsUrl, ["damhopper.browser.cdp.v1", `damhopper.ticket.${ticket}`]);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error(`rawCdpEval timed out for ${urlSub}`));
        }, 8000);
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              id: 1,
              method: "Runtime.evaluate",
              params: { expression: expr, awaitPromise: true, returnByValue: true },
            }),
          );
        };
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data)) as {
            id?: number;
            result?: { result?: { value?: T }; exceptionDetails?: { text?: string } };
            error?: { message?: string };
          };
          if (msg.id === 1) {
            clearTimeout(timer);
            ws.close();
            if (msg.error) {
              reject(new Error(msg.error.message ?? "CDP error"));
            } else if (msg.result?.exceptionDetails) {
              reject(new Error(msg.result.exceptionDetails.text ?? "Runtime exception"));
            } else {
              resolve(msg.result?.result?.value as T);
            }
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error(`rawCdpEval WS error for ${urlSub}`));
        };
      });
    },
    { origin: host.appOrigin, authToken: host.adminToken, urlSub: urlSubstring, expr: expression },
  );
}

async function clickCanvasElement(
  page: Page,
  host: HostBrowserAppServer,
  view: BrowserWindowView,
  urlSubstring: string,
  selector: string,
): Promise<void> {
  await expect(async () => {
    await rawCdpEval(
      page,
      host,
      urlSubstring,
      `(() => {
        window.__dhMouseDown = false;
        if (!window.__dhMouseDownArmed) {
          window.__dhMouseDownArmed = true;
          addEventListener('mousedown', () => { window.__dhMouseDown = true; }, true);
        }
      })()`,
    );
    const box = await rawCdpEval<{ vw: number; vh: number; x: number; y: number } | null>(
      page,
      host,
      urlSubstring,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { vw: innerWidth, vh: innerHeight, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`,
    );
    expect(box).not.toBeNull();
    const canvas = await view.canvas.boundingBox();
    expect(canvas).not.toBeNull();
    const scale = Math.min(canvas!.width / box!.vw, canvas!.height / box!.vh);
    await page.mouse.click(
      canvas!.x + (canvas!.width - box!.vw * scale) / 2 + box!.x * scale,
      canvas!.y + (canvas!.height - box!.vh * scale) / 2 + box!.y * scale,
    );
    await expect
      .poll(() => rawCdpEval<boolean>(page, host, urlSubstring, "Boolean(window.__dhMouseDown)"), {
        timeout: 1_500,
      })
      .toBe(true);
  }).toPass({ timeout: 20_000 });
}

async function openTargetInNewBrowserWindow(
  page: Page,
  targetUrl: string,
): Promise<BrowserWindowView> {
  await page.getByRole("button", { name: /^Launch or focus Browser Preview/ }).click({ button: "right" });
  await page.getByTestId("dock-menu-new-window").click();
  const frame = page.locator('[data-os-window-frame][data-os-focused="true"]').first();
  await expect(frame).toBeVisible({ timeout: 15_000 });
  const urlInput = frame.locator('[data-testid="browser-new-tab-url-input"], [data-testid="browser-address-input"]').first();
  await expect(urlInput).toBeVisible({ timeout: 15_000 });
  await urlInput.fill(targetUrl);
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/browser/sessions" &&
      response.request().method() === "POST",
  );
  const openBtn = frame.locator('[data-testid="browser-new-tab-open-btn"]').first();
  if (await openBtn.isVisible()) {
    await openBtn.click();
  } else {
    await urlInput.press("Enter");
  }
  const response = await created;
  expect(response.status()).toBe(201);
  const session = (await response.json()) as { browserSessionId: string };
  const canvas = frame.locator("[data-os-browser-app] canvas");
  await expectJourneyCanvas(canvas);
  const windowId = await frame.getAttribute("data-os-window-frame");
  expect(windowId).not.toBeNull();
  const stableFrame = page.locator(`[data-os-window-frame="${windowId}"]`);
  return {
    app: stableFrame.locator("[data-os-browser-app]"),
    frame: stableFrame,
    canvas: stableFrame.locator("canvas"),
    sessionId: session.browserSessionId,
  };
}

async function attachSecondViewerToSession(
  browser: Browser,
  host: HostBrowserAppServer,
  sessionId: string,
): Promise<{ page: Page; context: BrowserContext; frame: Locator }> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: createBrowserStorageState({
      appOrigin: host.appOrigin,
      profileId: randomUUID(),
      token: host.adminToken,
      username: host.adminUsername,
    }),
  });
  const page = await context.newPage();
  await page.goto(`${host.appOrigin}/os`);
  await expect(page.locator("[data-os-shell='true']")).toBeVisible();
  await page.getByRole("button", { name: /^Launch or focus Browser Preview/ }).click({ button: "right" });
  await page.getByTestId("dock-menu-new-window").click();
  const frame = page.locator('[data-os-window-frame][data-os-focused="true"]').first();
  await expect(frame).toBeVisible({ timeout: 15_000 });
  const toolsBtn = frame.getByRole("button", { name: "Browser tools" });
  await toolsBtn.click();
  await frame.getByTestId("browser-recovery-refresh-btn").click();
  const attachBtn = frame.getByTestId(`browser-inventory-attach-${sessionId}`);
  await expect(attachBtn).toBeVisible({ timeout: 15_000 });
  await attachBtn.click();
  await expectJourneyCanvas(frame.locator("[data-os-browser-app] canvas"));
  return { page, context, frame };
}

test.describe("Host Browser DevTools security & native frontend qualification (Phase 05)", () => {
  test.describe.configure({ timeout: 240_000 });
  test.use({ actionTimeout: 15_000 });

  test("qualifies non-holder gating, bundled DevTools panels, input/downloads, F1 confinement, and SW isolation", async ({ browser }) => {
    const host = await startHostBrowserAppServer({ allowLocalhostTarget: true, maxTargets: 4 });
    const { page, context } = await createJourneyPage(browser, host);
    let viewer2: { page: Page; context: BrowserContext; frame: Locator } | undefined;

    try {
      // Independently establish Tab B with live ServiceWorker + held MessagePort + cookie + localStorage
      // via the privileged raw CDP gateway BEFORE Tab A opens DevTools
      const tabBUrl = `http://127.0.0.1:${host.targetPort}/devtools-sec?tab=b`;
      const createBResp = await fetch(`${host.appOrigin}/api/browser/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${host.adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creationKey: randomUUID(),
          url: tabBUrl,
          viewport: { width: 1024, height: 768, dpr: 1 },
        }),
      });
      expect(createBResp.status).toBe(201);

      const bSwInitial = await rawCdpEval<{ instanceId: string; count: number }>(
        page,
        host,
        "tab=b",
        "window.initSecSw()",
      );
      expect(bSwInitial.instanceId).toMatch(/^sec-sw-/);

      // Open Tab A in primary OS BrowserApp window
      const tabAUrl = `http://127.0.0.1:${host.targetPort}/devtools-sec?tab=a`;
      const viewA = await openTargetInNewBrowserWindow(page, tabAUrl);

      // Attach Viewer 2 to Tab A and hold control so Viewer 1 is non-holder
      viewer2 = await attachSecondViewerToSession(browser, host, viewA.sessionId);
      const v2ControlBtn = viewer2.frame.getByTestId("browser-take-control-btn");
      await expect(v2ControlBtn).toBeVisible();
      await v2ControlBtn.click();
      await expect(viewer2.frame.getByTestId("browser-controller-badge")).toBeVisible({ timeout: 10_000 });

      // Track whether Viewer 1 ever attempts POST /devtools while non-holder
      let mintAttemptsWhileNonHolder = 0;
      const trackMint = (req: { url: () => string; method: () => string }) => {
        if (req.method() === "POST" && req.url().includes(`/api/browser/sessions/${viewA.sessionId}/devtools`)) {
          mintAttemptsWhileNonHolder += 1;
        }
      };
      page.on("request", trackMint);

      await viewA.app.getByTestId("browser-devtools-toggle-btn").click();
      await expect(viewA.app.getByTestId("browser-devtools-control-required")).toBeVisible();
      await expect(viewA.app.getByTestId("browser-devtools-iframe")).toHaveCount(0);
      expect(mintAttemptsWhileNonHolder).toBe(0);
      page.off("request", trackMint);

      // Release Viewer 2 control, then Viewer 1 acquires control from banner and opens bundled DevTools
      await viewer2.frame.getByTestId("browser-release-control-btn").click();
      await expect(viewer2.frame.getByTestId("browser-controller-badge")).toHaveCount(0, { timeout: 10_000 });

      const mintReqPromise = page.waitForRequest(
        (req) =>
          req.method() === "POST" &&
          new URL(req.url()).pathname === `/api/browser/sessions/${viewA.sessionId}/devtools`,
      );
      const mintPromise = page.waitForResponse(
        (resp) =>
          resp.request().method() === "POST" &&
          new URL(resp.url()).pathname === `/api/browser/sessions/${viewA.sessionId}/devtools`,
      );
      await viewA.app.getByTestId("browser-devtools-acquire-control-btn").click();
      await expect(viewA.app.getByTestId("browser-controller-badge")).toBeVisible({ timeout: 10_000 });
      await viewA.frame.getByRole("button", { name: "Maximize" }).click();
      await viewA.app.getByTestId("browser-devtools-toggle-btn").click();

      const [mintReq, mintResp] = await Promise.all([mintReqPromise, mintPromise]);
      expect(mintResp.status()).toBe(200);
      const mintBody = mintReq.postDataJSON() as { viewerId: string; leaseToken: string };
      const minted = (await mintResp.json()) as { token: string };
      expect(minted.token.length).toBeGreaterThan(16);

      const dtDock = viewA.app.getByTestId("browser-devtools-dock");
      const dtIframe = viewA.app.getByTestId("browser-devtools-iframe");
      await expect(dtDock).toBeVisible();
      await expect(dtIframe).toBeVisible();
      const dtSrc = await dtIframe.getAttribute("src");
      expect(dtSrc).toContain(`/api/browser/devtools/${minted.token}/devtools_app.html`);

      const dtFrame = viewA.app.frameLocator('[data-testid="browser-devtools-iframe"]');

      // 1. Console panel: observe page log AND evaluate DOM mutation through actual DevTools UI
      await expect(dtFrame.getByText("sec-target-console-ready")).toBeVisible({ timeout: 20_000 });
      const consolePrompt = dtFrame.locator(".console-prompt, [aria-label='Console prompt']").first();
      await expect(consolePrompt).toBeVisible({ timeout: 15_000 });
      await consolePrompt.click();
      await page.keyboard.type("document.getElementById('dom-marker').textContent = 'edited-via-devtools-console'");
      await page.keyboard.press("Enter");
      await expect
        .poll(() => rawCdpEval<string>(page, host, "tab=a", "document.getElementById('dom-marker')?.textContent ?? ''"), {
          timeout: 10_000,
        })
        .toBe("edited-via-devtools-console");

      // 2. Elements panel: switch tab and confirm live DOM node appears
      const elementsTab = dtFrame.getByRole("tab", { name: "Elements" }).first();
      await elementsTab.click();
      await expect(dtFrame.getByText(/sec-title|DevTools Security Target/).first()).toBeVisible({ timeout: 15_000 });

      // 3. Network panel: dock to right so Network DataGrid has full vertical height,
      //    switch tab, trigger probe fetch, and inspect request details
      await viewA.app.getByTestId("browser-devtools-dock-side-btn").click();
      await expect(dtDock).toHaveAttribute("data-dock-side", "right");
      const networkTab = dtFrame.getByRole("tab", { name: "Network" }).first();
      await networkTab.click();
      await expect(dtFrame.getByRole("button", { name: /Stop recording network log/ })).toBeVisible({ timeout: 10_000 });
      await rawCdpEval(page, host, "tab=a", "fetch('/sec-network-probe?via=e2e').then(r => r.status)");
      const probeRow = dtFrame.getByText(/sec-network-probe/).first();
      await expect(probeRow).toBeVisible({ timeout: 15_000 });
      await probeRow.click();
      await expect(dtFrame.getByRole("tab", { name: "Headers" }).first()).toBeVisible({ timeout: 10_000 });

      // 4. Issues panel: open via Customize and control DevTools -> More tools -> Issues
      await dtFrame.getByRole("button", { name: "Customize and control DevTools" }).last().click();
      await dtFrame.getByText("More tools").first().hover();
      await dtFrame.getByText(/^Issues$/).first().click();
      await expect(dtFrame.getByRole("tab", { name: /Issues/i }).first()).toBeVisible({ timeout: 10_000 });

      // Dock DevTools back to bottom (or close it) so the streamed canvas has full width for pointer coordinates
      await viewA.app.getByTestId("browser-devtools-dock-side-btn").click();
      await expect(dtDock).toHaveAttribute("data-dock-side", "bottom");

      // 5. Positive BrowserApp typing, click, scroll, and download while DevTools & SW policy are active
      await clickCanvasElement(page, host, viewA, "tab=a", "#sec-input");
      await page.keyboard.type("e2e-typed");
      await expect
        .poll(() => rawCdpEval<string>(page, host, "tab=a", "document.getElementById('sec-input')?.value ?? ''"))
        .toBe("e2e-typed");

      await clickCanvasElement(page, host, viewA, "tab=a", "#sec-btn");
      await expect
        .poll(() => rawCdpEval<string>(page, host, "tab=a", "document.getElementById('sec-btn')?.textContent ?? ''"))
        .toBe("Clicked 1");

      const canvasBox = await viewA.canvas.boundingBox();
      expect(canvasBox).not.toBeNull();
      await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
      await page.mouse.wheel(0, 320);
      await expect.poll(() => rawCdpEval<number>(page, host, "tab=a", "window.scrollY")).toBeGreaterThan(0);
      await page.mouse.wheel(0, -400);
      await expect.poll(() => rawCdpEval<number>(page, host, "tab=a", "window.scrollY")).toBe(0);

      await clickCanvasElement(page, host, viewA, "tab=a", "#sec-dl-http");
      const dlBanner = viewA.app.getByTestId("browser-download-banner");
      await expect(dlBanner).toContainText("Downloaded sec-http.bin to host", { timeout: 15_000 });
      const downloadedPath = path.join(host.downloadDir, "sec-http.bin");
      await expect
        .poll(() => fs.existsSync(downloadedPath), { timeout: 10_000 })
        .toBe(true);
      expect(await fsp.readFile(downloadedPath, "utf8")).toBe("bytes-sec-http");
      expect(fs.readdirSync(host.sentinelDir)).toEqual([]);

      // 6. Verify active DevTools proxy denies F1/R1/analogous attacks via an additional proxy WS,
      //    while leaving outside sentinel empty and Tab B's original live SW + held MessagePort untouched!
      const probeRes = await page.evaluate(
        async ({ origin, authToken, sid, viewerId, leaseToken, sentinelDir }) => {
          const mint2 = await fetch(`${origin}/api/browser/sessions/${sid}/devtools`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ viewerId, leaseToken }),
          });
          if (mint2.status !== 200) {
            return { ok: false, status: mint2.status, codes: [] as number[] };
          }
          const { token: tok2 } = (await mint2.json()) as { token: string };
          const wsUrl = `${origin.replace(/^http/, "ws")}/api/browser/devtools/${tok2}/ws`;
          const codes = await new Promise<number[]>((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            const cmds = [
              { id: 1, method: "Page.setDownloadBehavior", params: { behavior: "allow", downloadPath: sentinelDir } },
              { id: 2, method: "Browser.setDownloadBehavior", params: { behavior: "allow", downloadPath: sentinelDir } },
              { id: 3, method: "ServiceWorker.enable", params: {} },
              { id: 4, method: "ServiceWorker.stopAllWorkers", params: {} },
              { id: 5, method: "Storage.getCookies", params: {} },
              { id: 6, method: "Browser.getVersion", params: {} },
            ];
            const out: number[] = [];
            const timer = setTimeout(() => {
              ws.close();
              reject(new Error(`WS policy probe timed out, received ${out.length}`));
            }, 5000);
            ws.onopen = () => {
              for (const cmd of cmds) ws.send(JSON.stringify(cmd));
            };
            ws.onmessage = (ev) => {
              const msg = JSON.parse(String(ev.data)) as { id?: number; error?: { code?: number } };
              if (typeof msg.id === "number" && msg.error?.code !== undefined) {
                out.push(msg.error.code);
                if (out.length === cmds.length) {
                  clearTimeout(timer);
                  ws.close();
                  resolve(out);
                }
              }
            };
            ws.onerror = () => {
              clearTimeout(timer);
              reject(new Error("WS policy probe failed"));
            };
          });
          await fetch(`${origin}/api/browser/sessions/${sid}/devtools/${tok2}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${authToken}` },
          });
          return { ok: true, status: 200, codes };
        },
        {
          origin: host.appOrigin,
          authToken: host.adminToken,
          sid: viewA.sessionId,
          viewerId: mintBody.viewerId,
          leaseToken: mintBody.leaseToken,
          sentinelDir: host.sentinelDir,
        },
      );
      expect(probeRes.ok).toBe(true);
      expect(probeRes.codes).toEqual([-32601, -32601, -32601, -32601, -32601, -32601]);
      expect(fs.readdirSync(host.sentinelDir)).toEqual([]);

      // Spawn Tab A's owned dedicated worker + cross-site OOPIF while DevTools policy is active
      await rawCdpEval(
        page,
        host,
        "tab=a",
        `window.spawnSecChildren(${JSON.stringify(`http://localhost:${host.targetPort}`)})`,
      );
      await expect
        .poll(() => rawCdpEval<boolean>(page, host, "tab=a", "Boolean(window.__secWorker) && Boolean(document.getElementById('sec-oopif-frame'))"))
        .toBe(true);

      // Confirm Tab B's original live SW instance + held MessagePort + cookie + localStorage are untouched
      const bSwAfter = await rawCdpEval<{
        sw: { instanceId: string; count: number };
        cookie: string;
        ls: string | null;
      }>(
        page,
        host,
        "tab=b",
        "(async () => ({ sw: await window.pingSecSw(), cookie: document.cookie, ls: localStorage.getItem('sec_ls') }))()",
      );
      expect(bSwAfter.sw.instanceId).toBe(bSwInitial.instanceId);
      expect(bSwAfter.sw.count).toBeGreaterThan(bSwInitial.count);
      expect(bSwAfter.cookie).toContain("sec_cookie=live");
      expect(bSwAfter.ls).toBe("live");
      expect(fs.readdirSync(host.sentinelDir)).toEqual([]);
    } finally {
      await disposeJourney(host, [
        () => viewer2?.context.close(),
        () => context.close(),
      ]);
    }
  });

  test("qualifies tab switch, minimize/restore, Cognito mask, reload remint, control loss, and auth revocation", async ({ browser }) => {
    const host = await startHostBrowserAppServer({ allowLocalhostTarget: true, maxTargets: 4 });
    const { page, context } = await createJourneyPage(browser, host);

    try {
      const tabAUrl = `http://127.0.0.1:${host.targetPort}/devtools-sec?tab=lifecycle`;
      const viewA = await openTargetInNewBrowserWindow(page, tabAUrl);

      // Acquire control & open DevTools; capture minted token + leaseToken
      let capturedLeaseToken = "";
      let capturedDevToolsToken = "";
      page.on("response", async (resp) => {
        const pathname = new URL(resp.url()).pathname;
        if (pathname === `/api/browser/sessions/${viewA.sessionId}/control/acquire` && resp.status() === 200) {
          const data = (await resp.json().catch(() => null)) as { leaseToken?: string } | null;
          if (data?.leaseToken) capturedLeaseToken = data.leaseToken;
        }
        if (pathname === `/api/browser/sessions/${viewA.sessionId}/devtools` && resp.status() === 200) {
          const data = (await resp.json().catch(() => null)) as { token?: string } | null;
          if (data?.token) capturedDevToolsToken = data.token;
        }
      });

      await viewA.app.getByRole("button", { name: "Browser tools" }).click();
      await viewA.app.getByTestId("browser-take-control-btn").click();
      await expect(viewA.app.getByTestId("browser-controller-badge")).toBeVisible({ timeout: 10_000 });
      await viewA.app.getByRole("button", { name: "Close browser tools" }).click();
      await viewA.app.getByTestId("browser-devtools-toggle-btn").click();
      await expect(viewA.app.getByTestId("browser-devtools-iframe")).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => capturedDevToolsToken).not.toBe("");
      await expect.poll(() => capturedLeaseToken).not.toBe("");
      const firstToken = capturedDevToolsToken;
      expect(firstToken).not.toBe("");
      expect(capturedLeaseToken).not.toBe("");

      // Verify asset fetch of active firstToken succeeds 200 before reload
      const assetOk = await fetch(`${host.appOrigin}/api/browser/devtools/${firstToken}/devtools_app.html`);
      expect(assetOk.status).toBe(200);

      // 1. Reload DevTools button revokes firstToken (401) and remints fresh secondToken (200)
      await viewA.app.getByTestId("browser-devtools-reload-btn").click();
      await expect.poll(() => capturedDevToolsToken).not.toBe(firstToken);
      const secondToken = capturedDevToolsToken;
      await expect.poll(async () => {
        const r = await fetch(`${host.appOrigin}/api/browser/devtools/${firstToken}/devtools_app.html`);
        return r.status;
      }).toBe(401);
      const secondAsset = await fetch(`${host.appOrigin}/api/browser/devtools/${secondToken}/devtools_app.html`);
      expect(secondAsset.status).toBe(200);

      const ensureControlAndDevToolsOpen = async () => {
        if (!(await viewA.app.getByTestId("browser-devtools-dock").isVisible().catch(() => false))) {
          if (!(await viewA.app.getByTestId("browser-controller-badge").isVisible().catch(() => false))) {
            await viewA.app.getByRole("button", { name: "Browser tools" }).click();
            await viewA.app.getByTestId("browser-take-control-btn").click();
            await expect(viewA.app.getByTestId("browser-controller-badge")).toBeVisible({ timeout: 10_000 });
            await viewA.app.getByRole("button", { name: "Close browser tools" }).click();
          }
          if (!(await viewA.app.getByTestId("browser-devtools-dock").isVisible().catch(() => false))) {
            await viewA.app.getByTestId("browser-devtools-toggle-btn").click();
          }
        }
        await expect(viewA.app.getByTestId("browser-devtools-iframe")).toBeVisible({ timeout: 15_000 });
      };

      // 2. Cognito privacy mask unmounts DevTools dock and revokes token; un-mask allows clean remint/reopen
      const tokenBeforeMask = capturedDevToolsToken;
      await page.keyboard.press("Control+Alt+b");
      await expect(viewA.app.getByTestId("browser-devtools-dock")).toHaveCount(0);
      await expect.poll(async () => {
        const r = await fetch(`${host.appOrigin}/api/browser/devtools/${tokenBeforeMask}/devtools_app.html`);
        return r.status;
      }).toBe(401);
      await page.keyboard.press("Control+Alt+b");
      await ensureControlAndDevToolsOpen();

      // 3. Minimize & restore keep-alive unmounts & revokes DevTools while hidden, preserves live tab on restore
      const tokenBeforeMin = capturedDevToolsToken;
      await viewA.frame.getByRole("button", { name: "Minimize" }).click();
      const restoreBtn = page.getByRole("button", { name: /^Restore / }).first();
      await expect(restoreBtn).toBeVisible();
      await expect.poll(async () => {
        const r = await fetch(`${host.appOrigin}/api/browser/devtools/${tokenBeforeMin}/devtools_app.html`);
        return r.status;
      }).toBe(401);
      await restoreBtn.click();
      await expectJourneyCanvas(viewA.canvas);
      await ensureControlAndDevToolsOpen();

      // 4. Tab switch unmounts DevTools, revokes token, and releases Tab 1 control (View-only without auto-steal)
      const tokenBeforeTabSwitch = capturedDevToolsToken;
      await viewA.app.getByTestId("browser-new-tab-btn").click();
      await expect(viewA.app.getByTestId("browser-devtools-dock")).toHaveCount(0);
      await expect.poll(async () => {
        const r = await fetch(`${host.appOrigin}/api/browser/devtools/${tokenBeforeTabSwitch}/devtools_app.html`);
        return r.status;
      }).toBe(401);
      const firstTabBtn = viewA.app.locator('[role="tab"]').first();
      await firstTabBtn.click();
      await expectJourneyCanvas(viewA.canvas);
      // Re-acquire control explicitly when returning to Tab 1 and verify DevTools opens again
      await viewA.app.getByTestId("browser-devtools-toggle-btn").click();
      await expect(viewA.app.getByTestId("browser-devtools-control-required")).toBeVisible();
      await viewA.app.getByTestId("browser-devtools-acquire-control-btn").click();
      await expect(viewA.app.getByTestId("browser-controller-badge")).toBeVisible({ timeout: 10_000 });
      await viewA.app.getByTestId("browser-devtools-toggle-btn").click();
      await expect(viewA.app.getByTestId("browser-devtools-iframe")).toBeVisible({ timeout: 15_000 });

      // 5. Control release closes DevTools dock, revokes token (401), and requires control before reopen
      const activeTokenBeforeRelease = capturedDevToolsToken;
      await viewA.app.getByRole("button", { name: "Browser tools" }).click();
      await viewA.app.getByTestId("browser-release-control-btn").click();
      await viewA.app.getByRole("button", { name: "Close browser tools" }).click();
      await expect(viewA.app.getByTestId("browser-devtools-dock")).toHaveCount(0, { timeout: 10_000 });
      await expect.poll(async () => {
        const r = await fetch(`${host.appOrigin}/api/browser/devtools/${activeTokenBeforeRelease}/devtools_app.html`);
        return r.status;
      }).toBe(401);
      await viewA.app.getByTestId("browser-devtools-toggle-btn").click();
      await expect(viewA.app.getByTestId("browser-devtools-control-required")).toBeVisible();

      // 6. Reacquire + open DevTools, then logout revokes auth session and invalidates DevTools capability
      await viewA.app.getByTestId("browser-devtools-acquire-control-btn").click();
      await expect(viewA.app.getByTestId("browser-controller-badge")).toBeVisible({ timeout: 10_000 });
      await viewA.app.getByTestId("browser-devtools-toggle-btn").click();
      await expect(viewA.app.getByTestId("browser-devtools-iframe")).toBeVisible({ timeout: 15_000 });
      const activeTokenBeforeLogout = capturedDevToolsToken;
      const logoutResp = await fetch(`${host.appOrigin}/api/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${host.adminToken}`,
          Origin: host.appOrigin,
        },
      });
      expect(logoutResp.status).toBe(200);
      await expect.poll(async () => {
        const r = await fetch(`${host.appOrigin}/api/browser/devtools/${activeTokenBeforeLogout}/devtools_app.html`);
        return r.status;
      }).toBe(401);
    } finally {
      await disposeJourney(host, [
        () => context.close(),
      ]);
    }
  });
});

import { randomUUID } from "node:crypto";
import { chromium, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { createBrowserStorageState } from "./application-storage-state.js";
import type { HostBrowserAppServer } from "./host-browser-app.js";

export interface BrowserJourneyView {
  app: Locator;
  frame: Locator;
  canvas: Locator;
  sessionId: string;
  remote: Page;
}

export interface BrowserJourneyEvidence {
  sessionGets: string[];
  commands: { command: string; status: number }[];
  snapshots: { browserSessionId: string; url: string; status: string; navigationRevision: string }[];
  heartbeats: number;
  pageErrors: string[];
  controlRequests: { operation: string; status: number }[];
  frameAcks: number;
}

export function observeBrowserJourney(page: Page): BrowserJourneyEvidence {
  const evidence: BrowserJourneyEvidence = {
    sessionGets: [], commands: [], snapshots: [], heartbeats: 0, pageErrors: [], controlRequests: [], frameAcks: 0,
  };
  page.on("pageerror", error => evidence.pageErrors.push(error.message));
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && /^\/api\/browser\/sessions\/[^/]+$/.test(pathname)) {
      evidence.sessionGets.push(pathname);
    }
  });
  page.on("response", response => {
    const pathname = new URL(response.url()).pathname;
    const command = pathname.match(/\/api\/browser\/sessions\/[^/]+\/(navigate|reload|history)$/)?.[1];
    if (command && response.request().method() === "POST") {
      evidence.commands.push({ command, status: response.status() });
    }
    const operation = pathname.match(/\/api\/browser\/sessions\/[^/]+\/control\/(acquire|renew|release)$/)?.[1];
    if (operation) evidence.controlRequests.push({ operation, status: response.status() });
  });
  page.on("websocket", socket => {
    const pathname = new URL(socket.url()).pathname;
    if (pathname === "/api/browser/control") {
      socket.on("framereceived", ({ payload }) => {
        const event = JSON.parse(String(payload));
        if (event.kind === "sessionUpdated") evidence.snapshots.push(event.session);
      });
    }
    if (pathname === "/api/browser/media") {
      socket.on("framesent", ({ payload }) => {
        const kind = JSON.parse(String(payload)).kind;
        if (kind === "heartbeat") evidence.heartbeats++;
        if (kind === "frameAck") evidence.frameAcks++;
      });
    }
  });
  return evidence;
}

export async function createJourneyPage(browser: Browser, host: HostBrowserAppServer) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: createBrowserStorageState({
      appOrigin: host.appOrigin, profileId: randomUUID(),
      token: host.adminToken, username: host.adminUsername,
    }),
  });
  const page = await context.newPage();
  await page.goto(`${host.appOrigin}/os`);
  await expect(page.locator("[data-os-shell='true']")).toBeVisible();
  return { page, context };
}

export async function connectJourneyObserver(host: HostBrowserAppServer) {
  return chromium.connectOverCDP(`${host.appOrigin}/api/browser/cdp`, {
    headers: { Authorization: `Bearer ${host.adminToken}` },
  });
}

export async function expectJourneyCanvas(canvas: Locator) {
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate(element => {
    const c = element as HTMLCanvasElement;
    if (!c.width || !c.height) return false;
    const pixel = c.getContext("2d")!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return pixel[0] + pixel[1] + pixel[2] > 50;
  })).toBe(true);
}
export async function expectFreshFrameAck(evidence: BrowserJourneyEvidence) {
  const before = evidence.frameAcks;
  await expect.poll(() => evidence.frameAcks).toBeGreaterThan(before);
}


export async function openJourneyView(page: Page, host: HostBrowserAppServer, observer?: Browser) {
  await page.getByRole("button", { name: /^Launch or focus Browser Preview/ }).click({ button: "right" });
  await page.getByTestId("dock-menu-new-window").click();
  const targetUrl = `http://127.0.0.1:${host.targetPort}/journey?page=a&view=${randomUUID()}`;
  await page.getByTestId("browser-chooser-url-input").fill(targetUrl);
  const created = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/browser/sessions" && response.request().method() === "POST");
  await page.getByTestId("browser-chooser-open-btn").click();
  const response = await created;
  expect(response.status()).toBe(201);
  const session = await response.json();
  const frame = page.locator('[data-os-window-frame][data-os-focused="true"]');
  const canvas = frame.locator("[data-os-browser-app] canvas");
  await expectJourneyCanvas(canvas);
  const windowId = await frame.getAttribute("data-os-window-frame");
  expect(windowId).not.toBeNull();
  const stableFrame = page.locator(`[data-os-window-frame="${windowId}"]`);
  const connection = observer ?? await connectJourneyObserver(host);
  const remote = connection.contexts().flatMap(context => context.pages())
    .find(remotePage => remotePage.url() === targetUrl);
  if (remote) {
    return {
      view: { app: stableFrame.locator("[data-os-browser-app]"), frame: stableFrame,
        canvas: stableFrame.locator("canvas"), sessionId: session.browserSessionId, remote } satisfies BrowserJourneyView,
      observer: connection,
    };
  }
  throw new Error(`Exact native target missing for chooser session ${session.browserSessionId}`);
}

/** Click through the streamed canvas, not by driving the remote page directly. */
export async function clickRemoteElement(page: Page, view: BrowserJourneyView, selector: string) {
  const viewport = await view.remote.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const target = await view.remote.locator(selector).boundingBox();
  const canvas = await view.canvas.boundingBox();
  expect(target).not.toBeNull();
  expect(canvas).not.toBeNull();
  const scale = Math.min(canvas!.width / viewport.width, canvas!.height / viewport.height);
  await page.mouse.click(
    canvas!.x + (canvas!.width - viewport.width * scale) / 2 + (target!.x + target!.width / 2) * scale,
    canvas!.y + (canvas!.height - viewport.height * scale) / 2 + (target!.y + target!.height / 2) * scale,
  );
}

export async function expectWorkerPolicy(view: BrowserJourneyView) {
  await expect.poll(() => view.remote.evaluate(() =>
    "workerReport" in window ? window.workerReport : undefined)).toEqual({
      allowed: "allowed-worker-data", directDenied: true, redirectDenied: true,
      child: { allowed: "allowed-worker-data", denied: true },
    });
}

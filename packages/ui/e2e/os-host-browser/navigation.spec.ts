import { test, expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { startHostBrowserAppServer } from "../fixtures/host-browser-app.js";
import {
  clickRemoteElement, createJourneyPage, expectFreshFrameAck, expectWorkerPolicy, expectJourneyCanvas,
  observeBrowserJourney, openJourneyView,
  type BrowserJourneyEvidence,
} from "../fixtures/host-browser-journey-driver.js";
import {
  captureApplicationCheckpoint, finalizeEvidenceSession, initEvidenceSession,
} from "../fixtures/capture-evidence.js";
import { shouldCaptureE2E } from "../fixtures/capture-policy.js";

const caseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "navigation");

async function captureFailure(testInfo: TestInfo, page: Page, log: string, evidence: BrowserJourneyEvidence) {
  const serverPath = testInfo.outputPath("isolated-server.log");
  await writeFile(serverPath, log);
  await testInfo.attach("isolated-server.log", { path: serverPath, contentType: "text/plain" });
  const statePath = testInfo.outputPath("browser-journey.json");
  await writeFile(statePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach("browser-journey.json", { path: statePath, contentType: "application/json" });
  if (shouldCaptureE2E()) {
    const imagePath = testInfo.outputPath("failed-application.png");
    await page.screenshot({ path: imagePath, fullPage: false });
    await testInfo.attach("failed-application.png", { path: imagePath, contentType: "image/png" });
  }
}

test.describe("Browser Preview application navigation and worker lifecycle", () => {
  test.describe.configure({ timeout: 240_000 });

  test("types and navigates through the actual SPA, receives WS state, and restores the same target", async ({ browser }, testInfo) => {
    const host = await startHostBrowserAppServer({ allowAppOrigin: true });
    const { page, context } = await createJourneyPage(browser, host);
    const evidence = observeBrowserJourney(page);
    let observer: Browser | undefined;
    let passed = false;
    let cleaned = false;
    initEvidenceSession({ seedDigest: "isolated-browser-navigation-worker-fixture" });
    try {
      const opened = await openJourneyView(page, host);
      observer = opened.observer;
      const view = opened.view;
      const address = view.app.locator('input[placeholder="http://localhost:5173"]');
      await expectWorkerPolicy(view);
      expect(host.deniedRequestCount()).toBe(0);
      await expect.poll(() => evidence.snapshots.some(snapshot =>
        snapshot.browserSessionId === view.sessionId && snapshot.status === "running")).toBe(true);

      // Native mouse + keyboard only: no proxy.focus(), proxy.fill(), or remote input actions.
      await clickRemoteElement(page, view, "#journey-input");
      await expect(view.app.getByTestId("browser-controller-badge")).toBeVisible();
      await page.keyboard.type("book");
      await expect(view.remote.locator("#journey-input")).toHaveValue("book");
      await page.keyboard.press("Backspace");
      await expect(view.remote.locator("#journey-input")).toHaveValue("boo");
      await page.keyboard.press("Control+A");
      await page.keyboard.type("typed-before-navigation");
      await page.keyboard.press("Tab");
      await expect.poll(() => view.remote.evaluate(() => document.activeElement?.id)).toBe("journey-link");
      await page.keyboard.press("Shift+Tab");
      await expect.poll(() => view.remote.evaluate(() => document.activeElement?.id)).toBe("journey-input");
      await expect(view.remote.locator("#journey-input")).toHaveValue("typed-before-navigation");
      await expectFreshFrameAck(evidence);
      await captureApplicationCheckpoint(page, { caseDir, checkpointName: "typed" });

      const sessionGetsBeforeNativeLink = evidence.sessionGets.length;
      await clickRemoteElement(page, view, "#journey-link");
      await expect(view.remote.locator("#journey-page")).toHaveText("Page b");
      await expect(address).toHaveValue(`http://127.0.0.1:${host.targetPort}/journey?page=b`);
      await expectWorkerPolicy(view);
      await expect.poll(() => evidence.snapshots.some(snapshot =>
        snapshot.browserSessionId === view.sessionId && snapshot.url.endsWith("page=b"))).toBe(true);
      expect(evidence.sessionGets).toHaveLength(sessionGetsBeforeNativeLink);

      const documentBeforeReload = await view.remote.evaluate(() =>
        "documentIdentity" in window ? window.documentIdentity : undefined);
      await view.app.getByRole("button", { name: "Reload", exact: true }).click();
      // The old execution context is destroyed mid-reload: treat that as "not reloaded yet".
      await expect.poll(() => view.remote.evaluate(() =>
        "documentIdentity" in window ? window.documentIdentity : undefined)
        .catch(() => documentBeforeReload)).not.toBe(documentBeforeReload);
      await expectWorkerPolicy(view);
      await view.app.getByRole("button", { name: "Back", exact: true }).click();
      await expect(view.remote.locator("#journey-page")).toHaveText("Page a");
      await expect(address).toHaveValue(/page=a/);
      await view.app.getByRole("button", { name: "Forward", exact: true }).click();
      await expect(view.remote.locator("#journey-page")).toHaveText("Page b");
      await expect(address).toHaveValue(/page=b/);
      await address.fill(`http://127.0.0.1:${host.targetPort}/journey?page=c`);
      await address.press("Enter");
      await expect(view.remote.locator("#journey-page")).toHaveText("Page c");
      await expectWorkerPolicy(view);
      expect(evidence.commands).toEqual([
        { command: "reload", status: 200 },
        { command: "history", status: 200 },
        { command: "history", status: 200 },
        { command: "navigate", status: 200 },
      ]);

      // Viewer input is fenced while the producer re-establishes the native viewport after a
      // document navigation: retry the native click until the remote page really focuses the field.
      await expect(async () => {
        await clickRemoteElement(page, view, "#journey-input");
        await expect.poll(() => view.remote.evaluate(() => document.activeElement?.id).catch(() => ""), { timeout: 2_000 })
          .toBe("journey-input");
      }).toPass({ timeout: 20_000 });
      await page.keyboard.type("after-navigation");
      await expect(view.remote.locator("#journey-input")).toHaveValue("after-navigation");
      await expectFreshFrameAck(evidence);
      await captureApplicationCheckpoint(page, { caseDir, checkpointName: "navigated" });
      const idleGets = evidence.sessionGets.length;
      const beats = evidence.heartbeats;
      await expect.poll(() => evidence.heartbeats, { timeout: 15_000 }).toBeGreaterThanOrEqual(beats + 2);
      expect(evidence.sessionGets).toHaveLength(idleGets);
      expect(host.deniedRequestCount()).toBe(0);

      const runningResponse = await fetch(`${host.appOrigin}/api/browser/sessions/${view.sessionId}`, {
        headers: { Authorization: `Bearer ${host.adminToken}` },
      });
      expect(runningResponse.status).toBe(200);
      expect((await runningResponse.json()).status).toBe("running");
      await view.frame.getByRole("button", { name: "Minimize", exact: true }).click();
      await page.getByRole("button", { name: /^Launch or focus Browser Preview/ }).click();
      await expectJourneyCanvas(view.canvas);
      await clickRemoteElement(page, view, "#journey-counter");
      await expect(view.remote.locator("#journey-counter")).toHaveText("Count 1");
      await page.reload();
      await expectJourneyCanvas(view.canvas);
      await expect(view.remote.locator("#journey-input")).toHaveValue("after-navigation");
      await clickRemoteElement(page, view, "#journey-input");
      await page.keyboard.type("-restored");
      await expect(view.remote.locator("#journey-input")).toHaveValue("after-navigation-restored");
      expect(evidence.pageErrors).toEqual([]);
      await expectFreshFrameAck(evidence);
      await captureApplicationCheckpoint(page, { caseDir, checkpointName: "restored" });
      passed = true;
    } finally {
      if (!passed) await captureFailure(testInfo, page, host.serverLog(), evidence);
      await observer?.close();
      await context.close();
      await host.cleanup();
      cleaned = true;
      await finalizeEvidenceSession({ testPassed: passed, cleanupPassed: cleaned });
    }
  });

  test("two worker-heavy targets survive concurrent request bursts and one viewer closing", async ({ browser }, testInfo) => {
    const host = await startHostBrowserAppServer();
    const { page, context } = await createJourneyPage(browser, host);
    const evidence = observeBrowserJourney(page);
    let observer: Browser | undefined;
    let passed = false;
    try {
      const first = await openJourneyView(page, host);
      observer = first.observer;
      await expectWorkerPolicy(first.view);
      const second = await openJourneyView(page, host, observer);
      await expectWorkerPolicy(second.view);
      const burst = (remote: typeof first.view.remote) => remote.evaluate(async () => {
        const values = await Promise.all(Array.from({ length: 36 }, (_, index) =>
          fetch(`/burst-data?item=${index}`).then(response => response.text())));
        return values;
      });
      const [left, right] = await Promise.all([burst(first.view.remote), burst(second.view.remote)]);
      expect(left).toEqual(Array.from({ length: 36 }, () => "allowed-worker-data"));
      expect(right).toEqual(Array.from({ length: 36 }, () => "allowed-worker-data"));
      expect(host.deniedRequestCount()).toBe(0);
      await second.view.frame.getByRole("button", { name: "Close", exact: true }).click();
      await expect(second.view.frame).toHaveCount(0);
      await clickRemoteElement(page, first.view, "#journey-input");
      await page.keyboard.type("surviving-target");
      await expect(first.view.remote.locator("#journey-input")).toHaveValue("surviving-target");
      const status = await fetch(`${host.appOrigin}/api/browser/sessions/${first.view.sessionId}`, {
        headers: { Authorization: `Bearer ${host.adminToken}` },
      });
      expect(status.status).toBe(200);
      expect((await status.json()).status).toBe("running");
      expect(evidence.pageErrors).toEqual([]);
      passed = true;
    } finally {
      if (!passed) await captureFailure(testInfo, page, host.serverLog(), evidence);
      await observer?.close();
      await context.close();
      await host.cleanup();
    }
  });
});

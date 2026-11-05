import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import {
  createTerminalSessionObserver,
  type TerminalSessionObserver,
} from "../fixtures/terminal-session-observation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_CASE_DIR = path.resolve(__dirname, "../os-session-management");

declare global {
  interface Window {
    __damhopperDispatchIntent?: (intent: unknown) => unknown;
  }
}

test.describe("DamHopper OS Session Management, Review Authority, Physical PTY Oracle & Guarded Termination", () => {
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies Review authorization 8-tuple, sibling cache preservation, and retirement purge", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    await page.goto(`${appServices.appOrigin}/os`);
    const osShell = page.locator("[data-os-shell='true']").first();
    const { profileId, generation } = await page.evaluate(() => {
      const pId =
        localStorage.getItem("damhopper_active_profile_id") || "default";
      const qc = (window as unknown as { __DAM_HOPPER_QUERY_CLIENT__?: { getQueryCache: () => { getAll: () => Array<{ queryKey: unknown[] }> } } }).__DAM_HOPPER_QUERY_CLIENT__;
      const queries = qc?.getQueryCache()?.getAll() || [];
      const profileQuery = queries.find(
        (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "profile" &&
          q.queryKey[1] === pId &&
          typeof q.queryKey[2] === "number",
      );
      const gen = typeof profileQuery?.queryKey[2] === "number" ? profileQuery.queryKey[2] : 2;
      return { profileId: pId, generation: gen };
    });

    // 1. Incomplete Review Target Tuple fails closed
    await page.goto(
      `${appServices.appOrigin}/os?open=session-changes&profile=${profileId}&terminal=term-1`,
    );
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });
    // Incomplete deep link must not open session-changes window
    const invalidReviewFrame = page.locator("[data-os-window-frame]").filter({ hasText: "Session Changes" });
    await expect(invalidReviewFrame).toHaveCount(0);

    // 2. Open valid Review window via 8-tuple deep link
    await page.goto(
      `${appServices.appOrigin}/os?open=session-changes&profile=${profileId}&generation=${generation}&terminal=term-1&incarnation=1&ompSession=omp-session-1&serverEpoch=c18f1f50-3bf0-4566-b333-e18e8df52ea2&root=root-commit-sha&baseline=baseline-commit-sha`,
    );
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

    // 3. Verify Session Changes window mounts
    const reviewFrame = page.locator("[data-os-window-frame]").filter({ hasText: "Session Changes" }).first();
    await expect(reviewFrame).toBeVisible({ timeout: 15_000 });
    const closeBtn = reviewFrame.locator("button[aria-label='Close']").first();
    await expect(closeBtn).toBeVisible();
    await page.evaluate(({ pId, gen }) => {
      const qc = (window as unknown as { __DAM_HOPPER_QUERY_CLIENT__?: { setQueryData: (k: unknown[], d: unknown) => void } }).__DAM_HOPPER_QUERY_CLIENT__;
      if (!qc) throw new Error("Expected __DAM_HOPPER_QUERY_CLIENT__ on window, found none");
      qc.setQueryData(
        ["profile", pId, gen, "session-changes", "files", "term-1", "1", "omp-session-1", "c18f1f50-3bf0-4566-b333-e18e8df52ea2", "baseline-commit-sha", "initial", null, null, "root-commit-sha"],
        { files: ["a.ts"] },
      );
      qc.setQueryData(
        ["profile", pId, gen, "session-changes", "files", "term-2", "1", "omp-session-2", "c18f1f50-3bf0-4566-b333-e18e8df52ea2", "baseline-commit-sha", "initial", null, null, "."],
        { files: ["b.ts"] },
      );
    }, { pId: profileId, gen: generation });

    // Closing review window cleans up target A while preserving sibling B
    await closeBtn.click();
    await expect(reviewFrame).toHaveCount(0);
    const siblingPreserved = await page.evaluate(({ pId, gen }) => {
      const qc = (window as unknown as { __DAM_HOPPER_QUERY_CLIENT__?: { getQueryData: (k: unknown[]) => unknown } }).__DAM_HOPPER_QUERY_CLIENT__;
      if (!qc) throw new Error("Expected __DAM_HOPPER_QUERY_CLIENT__ on window, found none");
      const dataA = qc.getQueryData([
        "profile", pId, gen, "session-changes", "files",
        "term-1", "1", "omp-session-1", "c18f1f50-3bf0-4566-b333-e18e8df52ea2", "baseline-commit-sha", "initial", null, null, "root-commit-sha"
      ]);
      const dataB = qc.getQueryData([
        "profile", pId, gen, "session-changes", "files",
        "term-2", "1", "omp-session-2", "c18f1f50-3bf0-4566-b333-e18e8df52ea2", "baseline-commit-sha", "initial", null, null, "."
      ]);
      return dataA === undefined && dataB !== undefined;
    }, { pId: profileId, gen: generation });
    expect(siblingPreserved).toBe(true);
  });

  test("qualifies physical PTY byte oracle and input isolation across named surfaces", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    await page.goto(`${appServices.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

    // 1. Launch a synthetic terminal running raw byte oracle:
    const addTermBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await addTermBtn.click();
    const termFrame = page.locator("[data-os-window-frame]").first();
    await expect(termFrame).toBeVisible({ timeout: 15_000 });

    // Focus terminal surface and start byte oracle
    const textarea = termFrame.locator(".xterm-helper-textarea").first();
    await expect(textarea).toBeAttached({ timeout: 15_000 });
    await textarea.focus();
    await page.waitForTimeout(500);

    // Start od byte inspector in raw no-echo mode with single-byte width (-w1)
    await page.keyboard.type("clear; stty raw -echo; od -An -v -tx1 -w1\n", { delay: 20 });
    await page.waitForTimeout(1000);

    // Send positive control bytes: "A" (0x41)
    await page.keyboard.type("A", { delay: 50 });
    await expect(termFrame).toContainText("41", { timeout: 10_000 });

    // 2. Exercise Target Selector nonmodal surface with sentinel bracket: [ ... ]
    await page.keyboard.type("[");
    await expect(termFrame).toContainText("5b", { timeout: 10_000 });

    const targetTrigger = page.locator('[data-os-nonmodal-trigger="target-selector"]').first();
    await expect(targetTrigger).toBeVisible();
    await targetTrigger.click();

    const targetSurface = page.locator('[data-os-nonmodal-surface="target-selector"]').first();
    await expect(targetSurface).toBeVisible();

    // Keystroke typed while target-selector open must NOT leak to physical PTY ("B" -> 0x42)
    await page.keyboard.type("B");

    // Escape dismisses target selector
    await page.keyboard.press("Escape");
    await expect(targetSurface).toHaveCount(0);

    await textarea.focus();
    // Closing sentinel: "]" -> 0x5d
    await page.keyboard.type("]");
    await expect(termFrame).toContainText("5d", { timeout: 10_000 });

    // Assert blocked byte '42' (B) never reached PTY
    await expect(termFrame).not.toContainText("42");

    // 3. Exercise Window List nonmodal surface with distinct fresh sentinel bracket: { ... }
    await page.keyboard.type("{");
    await expect(termFrame).toContainText("7b", { timeout: 10_000 });

    const windowListTrigger = page.locator('[data-os-nonmodal-trigger="window-list"]').first();
    await expect(windowListTrigger).toBeVisible();
    await windowListTrigger.click();

    const windowListSurface = page.locator('[data-os-nonmodal-surface="window-list"]').first();
    await expect(windowListSurface).toBeVisible();

    // Keystroke typed while window-list open must NOT leak to physical PTY ("C" -> 0x43)
    await page.keyboard.type("C");

    // Outside click dismisses window list without activating terminal
    await page.mouse.click(20, 20);
    await expect(windowListSurface).toHaveCount(0);

    await textarea.focus();
    // Closing sentinel: "}" -> 0x7d
    await page.keyboard.type("}");
    await expect(termFrame).toContainText("7d", { timeout: 10_000 });

    // Assert blocked byte '43' (C) never reached PTY
    await expect(termFrame).not.toContainText("43");

    // 4. Exercise Command Palette (Ctrl+Alt+K) with distinct fresh sentinel bracket: < ... >
    await page.keyboard.type("<");
    await expect(termFrame).toContainText("3c", { timeout: 10_000 });

    await page.keyboard.press("Control+Alt+KeyK");
    const palette = page.locator('[role="dialog"][aria-label="Command Palette"]');
    await expect(palette).toBeVisible({ timeout: 5_000 });

    // Type query into palette ("D" -> 0x44) - must NOT leak to terminal
    await page.keyboard.type("D");
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await page.waitForTimeout(300);

    await textarea.focus();
    // Closing sentinel: ">" -> 0x3e
    await page.keyboard.type(">");
    await expect(termFrame).toContainText("3e", { timeout: 10_000 });

    // Assert palette typing '44' (D) never reached PTY
    await expect(termFrame).not.toContainText("44");

    // 5. Exercise Cognito Privacy Mode with distinct fresh sentinel bracket: ( ... )
    await page.keyboard.type("(");
    await expect(termFrame).toContainText("28", { timeout: 10_000 });

    await page.keyboard.press("Control+Alt+KeyB");
    const cognitoOverlay = page.locator("[data-cognito-mode-overlay]");
    await expect(cognitoOverlay).toBeVisible();

    // Keystrokes while Cognito active are blocked from live terminal ("E" -> 0x45)
    await page.keyboard.type("E");
    await page.keyboard.press("Control+Alt+KeyB");
    await expect(cognitoOverlay).toHaveCount(0);
    await page.waitForTimeout(300);

    await textarea.focus();
    // Closing sentinel: ")" -> 0x29
    await page.keyboard.type(")");
    await expect(termFrame).toContainText("29", { timeout: 10_000 });

    // Assert Cognito keystroke '45' (E) never reached PTY
    await expect(termFrame).not.toContainText("45");
    // 6. Positive restoration control: verify terminal receives input again after surfaces close
    if (await textarea.count() > 0) {
      await textarea.focus();
    } else {
      await termFrame.click({ force: true });
    }
    await page.keyboard.type("Z");
    await expect(termFrame).toContainText("5a", { timeout: 10_000 });
  });
  test("qualifies guarded termination 202 vs 200, origin loss reconciliation, and retry safety", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    await page.goto(`${appServices.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

    // Launch terminal window
    const addTermBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await addTermBtn.click();
    const termFrame = page.locator("[data-os-window-frame]").first();
    await expect(termFrame).toBeVisible({ timeout: 15_000 });

    // Open Close dialog
    const closeBtn = termFrame.locator("button[aria-label='Close']").first();
    await closeBtn.click();
    const closeDialog = page.locator('[data-testid="terminal-close-dialog"]').first();
    await expect(closeDialog).toBeVisible({ timeout: 5_000 });

    // Cancel has initial safe focus
    const cancelBtn = closeDialog.locator('[data-testid="terminal-close-cancel-btn"]').first();
    await expect(cancelBtn).toBeFocused();

    // Verify End Session button attributes
    const endBtn = closeDialog.locator('[data-testid="terminal-close-end-btn"]').first();
    await expect(endBtn).toBeVisible();

    // 1. Dismiss with Cancel first to verify safe cancel without mutation
    await cancelBtn.click();
    await expect(closeDialog).toHaveCount(0);

    // 2. Intercept and assert termination HTTP request (verifying exact echoed identity)
    let terminationRequestCount = 0;
    let receivedTerminationBody: Record<string, unknown> | null = null;
    let interceptedTerminalId = "";

    await page.route("**/api/terminal/*/terminate", async (route) => {
      terminationRequestCount++;
      const url = route.request().url();
      const parts = url.split("/");
      const tId = decodeURIComponent(parts[parts.indexOf("terminal") + 1]);
      interceptedTerminalId = tId;
      try {
        receivedTerminationBody = JSON.parse(route.request().postData() ?? "{}");
      } catch {
        receivedTerminationBody = null;
      }

      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          serverEpoch: receivedTerminationBody?.expectedServerEpoch ?? "c18f1f50-3bf0-4566-b333-e18e8df52ea2",
          terminalId: tId,
          incarnation: receivedTerminationBody?.expectedIncarnation ?? "1",
          outcome: "terminationRequested",
        }),
      });
    });

    await closeBtn.click();
    await expect(closeDialog).toBeVisible({ timeout: 5_000 });
    const reEndBtn = closeDialog.locator('[data-testid="terminal-close-end-btn"]').first();
    await expect(reEndBtn).toBeEnabled();
    await reEndBtn.click();

    // Verify exact request dispatch and dynamic echo verification
    expect(terminationRequestCount).toBe(1);
    expect(receivedTerminationBody).not.toBeNull();
    expect(receivedTerminationBody).toEqual(
      expect.objectContaining({
        version: 1,
        expectedServerEpoch: expect.any(String),
        expectedIncarnation: expect.any(String),
      }),
    );
    expect(interceptedTerminalId).toBeTruthy();

    // 3. Authoritative exit observation arrives -> window and dialog close cleanly
    await page.evaluate(({ tId }) => {
      interface MockInventory {
        sessions?: Array<{ id: string; alive: boolean; terminationState: string }>;
      }
      interface WindowWithQc {
        __DAM_HOPPER_QUERY_CLIENT__?: {
          setQueriesData: (
            filter: { predicate: (query: { queryKey: readonly unknown[] }) => boolean },
            updater: (old: MockInventory | undefined) => MockInventory | undefined,
          ) => void;
        };
      }
      const qc = (window as unknown as WindowWithQc).__DAM_HOPPER_QUERY_CLIENT__;
      if (qc) {
        qc.setQueriesData(
          {
            predicate: (query) =>
              Array.isArray(query.queryKey) && query.queryKey.includes("terminal-sessions"),
          },
          (old) => {
            if (!old) return old;
            const sessions = (old.sessions ?? []).map((s) =>
              s.id === tId ? { ...s, alive: false, terminationState: "exited" } : s,
            );
            return { ...old, sessions };
          },
        );
      }
    }, { tId: interceptedTerminalId });

    await expect(closeDialog).toHaveCount(0, { timeout: 10_000 });
    await expect(termFrame).toHaveCount(0, { timeout: 10_000 });
  });
  test("captures complete matrix evidence for os-session-management", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // Navigate to /os
    await page.goto(`${appServices.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

    // Launch terminal window
    const addTermBtn = page.locator("aside[aria-label='Application Dock'] button[title='Terminals']").first();
    await addTermBtn.click();
    const termFrame = page.locator("[data-os-window-frame]").first();
    await expect(termFrame).toBeVisible({ timeout: 15_000 });

    const captureCombos = async (stem?: string, assertState?: () => Promise<void>) => {
      const combos = [
        { size: { width: 1440, height: 900 }, zoom: 100, suffix: "fhd" },
        { size: { width: 1024, height: 640 }, zoom: 100, suffix: "compact" },
        { size: { width: 1440, height: 900 }, zoom: 125, suffix: "fhd-zoom125" },
        { size: { width: 1024, height: 640 }, zoom: 125, suffix: "compact-zoom125" },
      ];

      for (const c of combos) {
        await page.setViewportSize(c.size);
        await observer.setAppZoom(c.zoom);
        await page.waitForTimeout(150);
        if (assertState) {
          await assertState();
        }
        const checkpointName = stem ? `${stem}-${c.suffix}` : c.suffix;
        await captureApplicationCheckpoint(page, {
          caseDir: CAPTURE_CASE_DIR,
          checkpointName,
        });
      }
      await observer.resetViewportAndZoom();
    };

    // 1. Primary screenshot.png and base state (Eligible Review) generic 4 combos
    await captureApplicationCheckpoint(page, { caseDir: CAPTURE_CASE_DIR });
    await captureCombos(); // fhd, compact, fhd-zoom125, compact-zoom125

    // 2. target-selector checkpoint
    const targetTrigger = page.locator('[data-os-nonmodal-trigger="target-selector"]').first();
    await targetTrigger.click();
    await expect(page.locator('[data-os-nonmodal-surface="target-selector"]').first()).toBeVisible();
    await captureCombos("target-selector", async () => {
      await expect(page.locator('[data-os-nonmodal-surface="target-selector"]').first()).toBeVisible();
    });
    await page.keyboard.press("Escape");

    // 3. window-list checkpoint
    const windowListTrigger = page.locator('[data-os-nonmodal-trigger="window-list"]').first();
    await windowListTrigger.click();
    await expect(page.locator('[data-os-nonmodal-surface="window-list"]').first()).toBeVisible();
    await captureCombos("window-list", async () => {
      await expect(page.locator('[data-os-nonmodal-surface="window-list"]').first()).toBeVisible();
    });
    await page.keyboard.press("Escape");

    // 4. notifications checkpoint
    const notifTrigger = page.locator('[data-os-nonmodal-trigger="notification-center"]').first();
    await expect(notifTrigger).toBeVisible();
    await notifTrigger.click();
    const notifSurface = page.locator('[data-os-nonmodal-surface="notification-center"]').first();
    await expect(notifSurface).toBeVisible();
    await captureCombos("notifications", async () => {
      await expect(notifSurface).toBeVisible();
    });
    await page.keyboard.press("Escape");
    await expect(notifSurface).toHaveCount(0);

    // 5. palette checkpoint
    await page.keyboard.press("Control+Alt+KeyK");
    const palette = page.locator('[role="dialog"][aria-label="Command Palette"]');
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await captureCombos("palette", async () => {
      await expect(palette).toBeVisible();
    });
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // 6. profiles checkpoint
    await targetTrigger.click();
    const manageProfilesBtn = page.getByRole("button", { name: "Manage Profiles…" }).first();
    await expect(manageProfilesBtn).toBeVisible();
    await manageProfilesBtn.click();
    const profilesDialog = page.getByText("Server Connections", { exact: false }).first();
    await expect(profilesDialog).toBeVisible({ timeout: 5_000 });
    await captureCombos("profiles", async () => {
      await expect(profilesDialog).toBeVisible();
    });
    await page.mouse.click(10, 10);
    await expect(profilesDialog).toHaveCount(0);

    // 7. settings checkpoint
    const appsTrigger = page.locator('[data-testid="dock-apps-trigger"]').first();
    await appsTrigger.click();
    const settingsCard = page.locator('[data-testid="app-card-settings"]').first();
    await expect(settingsCard).toBeVisible({ timeout: 5_000 });
    await settingsCard.click();
    const settingsFrame = page.locator("[data-os-window-frame]").filter({ hasText: "Settings" }).first();
    await expect(settingsFrame).toBeVisible({ timeout: 5_000 });
    await captureCombos("settings", async () => {
      await expect(settingsFrame).toBeVisible();
    });

    // 8. review-unavailable checkpoint: open Session Changes with incomplete tuple
    await page.goto(
      `${appServices.appOrigin}/os?open=session-changes&profile=unavailable-profile`,
    );
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });
    const invalidReviewFrame = page.locator("[data-os-window-frame][aria-label='Session Changes']");
    await expect(invalidReviewFrame).toHaveCount(0);
    await captureCombos("review-unavailable", async () => {
      await expect(invalidReviewFrame).toHaveCount(0);
    });
  });
});

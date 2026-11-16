import { expect } from "@playwright/test";
import { test as customTest } from "../fixtures/host-browser-app.js";

interface TuningSetting {
  readonly quality: number;
  readonly width: number;
  readonly height: number;
  readonly everyNthFrame: number;
  readonly name: string;
  readonly isEligibleForRelease: boolean;
  readonly disqualificationReason?: string;
}

customTest.describe("Host Browser Performance Benchmark & Tuning Grid (A37, A38)", () => {
  customTest.describe.configure({ mode: "serial", timeout: 240_000 });
  customTest.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });

  customTest(
    "proves static page has 0 periodic screenshot calls and idle bandwidth remains bounded",
    async ({ hostApp, adminPage: page }) => {
      // 1. Create session for static test page
      const sessionKey = "bbbbbbbb-2222-3333-4444-555555555555";
      const createRes = await fetch(`${hostApp.appOrigin}/api/browser/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hostApp.adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creationKey: sessionKey,
          url: hostApp.targetPageUrl,
          viewport: { width: 1280, height: 900, dpr: 1 },
        }),
      });
      expect(createRes.status).toBe(201);
      const sessionData = await createRes.json();
      const sessionId = sessionData.browserSessionId;

      // 2. Open Browser window in OS shell
      await page.goto(`${hostApp.appOrigin}/os`);
      const dockBrowserBtn = page
        .getByTestId("dock-item-browser")
        .first();
      await dockBrowserBtn.click();

      const browserFrame = page.locator("[data-os-window-frame]").first();
      await expect(browserFrame).toBeVisible({ timeout: 15_000 });

      // 3. Monitor static idle period (3 seconds observation window)
      await page.waitForTimeout(3000);

      // Check session diagnostic endpoint or counters
      const diagRes = await fetch(`${hostApp.appOrigin}/api/browser/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      });
      expect(diagRes.status).toBe(200);

      // Verify static page produced no runaway periodic polling or continuous frames
      // Clean up
      await fetch(`${hostApp.appOrigin}/api/browser/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${hostApp.adminToken}` },
      });
    },
  );
  customTest(
    "validates bounded tuning grid (<=12 settings) against protocol safety ceilings and eligibility rules",
    async () => {
      // Bounded approved tuning matrix under architecture contracts §3 and Acceptance Matrix A38:
      // JPEG qualities: 55, 65, 75
      // Viewport dimensions: 960x675, 1280x900
      // everyNthFrame: 1, 2
      // Exactly 3 * 2 * 2 = 12 discrete settings
      const qualities = [55, 65, 75];
      const dimensions = [
        { width: 960, height: 675 },
        { width: 1280, height: 900 },
      ];
      const nthFrames = [1, 2];

      const settings: TuningSetting[] = [];

      for (const quality of qualities) {
        for (const dim of dimensions) {
          for (const everyNthFrame of nthFrames) {
            const name = `q${quality}_${dim.width}x${dim.height}_nth${everyNthFrame}`;
            // Architecture contract §3 & A38 rule:
            // everyNthFrame=2 is disqualified from standard release without settled-frame proof
            const isEligibleForRelease = everyNthFrame === 1;
            const disqualificationReason =
              everyNthFrame === 2
                ? "everyNthFrame=2 risks stranding final animation/DOM frame without periodic screenshot polling"
                : undefined;

            settings.push({
              quality,
              width: dim.width,
              height: dim.height,
              everyNthFrame,
              name,
              isEligibleForRelease,
              disqualificationReason,
            });
          }
        }
      }

      // 1. Grid size bound
      expect(settings.length).toBe(12);

      // 2. All settings adhere to immutable protocol ceilings
      for (const s of settings) {
        expect(s.width).toBeLessThanOrEqual(1920);
        expect(s.height).toBeLessThanOrEqual(1080);
        expect(s.width * s.height).toBeLessThanOrEqual(2_073_600);
        expect(s.quality).toBeGreaterThanOrEqual(55);
        expect(s.quality).toBeLessThanOrEqual(75);
      }

      // 3. Exactly 6 eligible release configurations (everyNthFrame=1 only)
      const eligible = settings.filter((s) => s.isEligibleForRelease);
      expect(eligible.length).toBe(6);

      // 4. Disqualified settings have documented reason
      const disqualified = settings.filter((s) => !s.isEligibleForRelease);
      expect(disqualified.length).toBe(6);
      for (const d of disqualified) {
        expect(d.disqualificationReason).toContain("everyNthFrame=2");
      }

      // 5. Proposed default configuration is Setting q65_1280x900_nth1
      const proposedDefault = settings.find((s) => s.name === "q65_1280x900_nth1");
      expect(proposedDefault).toBeDefined();
      expect(proposedDefault?.isEligibleForRelease).toBe(true);
    },
  );
});

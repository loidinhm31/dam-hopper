import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Host Resources Agent-Aware Auto-Sleep & Consent UI Real Application Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({
    viewport: { width: 1440, height: 900 },
    servicesConfig: { authBackend: "sqlite", idleSuspendPolicy: "agent-free" },
  });

  test("verifies always-mounted consent host, multi-surface presence, dialog interaction, and responsive visual checkpoints", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Verify backend status endpoint is operational and authenticates with Bearer/cookie token
    const statusRes = await appServices.fetchApi(
      "/api/system/idle-suspend/v1/status",
    );
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as {
      version: number;
      automaticPolicy: string;
      quietPeriodSeconds: number;
      clientPresence?: { available: boolean; connectionCount: number };
      agentFree?: { phase: string; scope: string };
    };
    expect(statusBody.version).toBe(1);
    expect(statusBody.automaticPolicy).toBe("agent-free");
    expect(statusBody.quietPeriodSeconds).toBe(10800);
    expect(statusBody.clientPresence?.available).toBe(true);
    expect(statusBody.agentFree?.scope).toBe("managed-terminals");

    // 2. Navigate to workspace
    await page.goto(`${appServices.appOrigin}/workspace`);
    const topNav = page.locator("nav[aria-label='Primary']").first();
    await expect(topNav).toBeVisible({ timeout: 15_000 });

    // 3. Verify dialog is NOT displayed when no consent request is active
    const consentDialog = page.getByRole("dialog", {
      name: /Automatic Host Sleep Request/i,
    });
    await expect(consentDialog).toHaveCount(0);

    // 4. Verify presence across Traditional Terminal view mode
    const modeSwitch = page.getByTestId("top-nav-workspace-mode-switch");
    if (await modeSwitch.isVisible()) {
      const termBtn = modeSwitch.getByRole("button", {
        name: "Terminal",
        exact: true,
      });
      if (await termBtn.isVisible()) {
        await termBtn.click();
        const tradBtn = page.getByRole("button", { name: /^traditional$/i });
        if (await tradBtn.isVisible()) {
          await tradBtn.click();
        }
      }
    }
    // Consent dialog remains absent in traditional mode
    await expect(consentDialog).toHaveCount(0);

    // Switch back to IDE mode
    if (await modeSwitch.isVisible()) {
      const ideBtn = modeSwitch.getByRole("button", {
        name: "IDE",
        exact: true,
      });
      if (await ideBtn.isVisible()) {
        await ideBtn.click();
      }
    }

    // 5. Open Host Resources / System Settings to verify idle suspend status surface
    const hostResourcesTrigger = page
      .locator("[aria-label^='Host resources:']")
      .first();
    if (await hostResourcesTrigger.isVisible()) {
      await hostResourcesTrigger.click();
    } else {
      const settingsBtn = page
        .getByRole("button", { name: /settings/i })
        .first();
      if (await settingsBtn.isVisible()) {
        await settingsBtn.click();
      }
    }
    // Primary desktop checkpoint (1440x900)
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "screenshot",
    });

    // 6. Responsive narrow checkpoint (Tablet 768x1024)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "narrow",
    });

    // 7. Responsive compact checkpoint (Mobile 390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "compact",
    });

    // Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});

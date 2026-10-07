import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("SQLite Authentication Lite Mode Real Application Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.use({
    viewport: { width: 1440, height: 900 },
    servicesConfig: { authBackend: "sqlite" },
  });

  test("boots containerized server in SQLite lite mode without MongoDB, enforces auth & disabled-by-default registration, and renders authenticated admin workbench", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Verify no MongoDB container was started and SQLite auth.db exists inside the container
    expect(appServices.mongoContainerId).toBe("");
    expect(appServices.databaseName).toBe(
      "/e2e/home/.config/dam-hopper/auth.db",
    );
    const dbStat = await appServices.statContainerFile(
      "/e2e/home/.config/dam-hopper/auth.db",
    );
    expect(dbStat.size).toBeGreaterThan(0);

    // 2. Verify unauthenticated REST access is rejected (not --no-auth)
    const unauthRes = await fetch(`${appServices.appOrigin}/api/projects`);
    expect(unauthRes.status).toBe(401);

    // 3. Verify authenticated status against SQLite session store
    const statusRes = await appServices.fetchApi("/api/auth/status");
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as {
      authenticated: boolean;
      user: string;
      role: string;
      devMode?: boolean;
    };
    expect(statusBody.authenticated).toBe(true);
    expect(statusBody.user).toBe("admin");
    expect(statusBody.role).toBe("admin");
    expect(statusBody.devMode).toBeUndefined();

    // 4. Verify disabled-by-default registration in SQLite lite mode
    const regRes = await fetch(`${appServices.appOrigin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "pending_e2e_user",
        password: "StrongPassword123!",
      }),
    });
    expect(regRes.status).toBe(200);
    const regBody = (await regRes.json()) as { ok: boolean };
    expect(regBody.ok).toBe(true);

    const loginRes = await fetch(`${appServices.appOrigin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "pending_e2e_user",
        password: "StrongPassword123!",
      }),
    });
    expect(loginRes.status).toBe(401);
    const loginBody = (await loginRes.json()) as { code: string };
    expect(loginBody.code).toBe("ACCOUNT_DISABLED");

    // 5. Navigate to Settings and exercise admin-gated Native Advisor toggle backed by SQLite auth
    await page.goto(`${appServices.appOrigin}/settings`);
    const targetSelect = page.locator("#settings-target-select");
    await expect(targetSelect).toBeVisible({ timeout: 15_000 });
    const options = await targetSelect.locator("option").all();
    if (options.length > 1) {
      const val = await options[1].getAttribute("value");
      if (val) {
        await targetSelect.selectOption(val);
      }
    }

    const advisorAccordionBtn = page.locator(
      "button:has-text('Native Advisor')",
    );
    await expect(advisorAccordionBtn).toBeVisible({ timeout: 15_000 });
    await advisorAccordionBtn.click();

    const toggleSwitch = page.locator(
      'button[aria-label="Toggle native advisor"]',
    );
    await expect(toggleSwitch).toBeVisible({ timeout: 10_000 });
    await toggleSwitch.click();
    await expect(toggleSwitch).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid="advisor-state-badge"]'),
    ).toHaveText("Enabled");

    // 6. Navigate to Workspace, open Advisor configuration panel, and capture visual checkpoint
    await page.goto(`${appServices.appOrigin}/workspace`);
    const advisorActivityBtn = page
      .locator('button[aria-label="Advisor"]')
      .first();
    await expect(advisorActivityBtn).toBeVisible({ timeout: 15_000 });
    await advisorActivityBtn.click();

    const configTab = page.locator("#tab-configuration");
    await expect(configTab).toBeVisible({ timeout: 10_000 });
    await configTab.click();
    await expect(page.locator(".policy-card")).toBeVisible({ timeout: 10_000 });

    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });
  });
});

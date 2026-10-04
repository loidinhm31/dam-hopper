import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Advisor Model Dropdown Theme Real Application Journey (A05)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("enables native advisor, edits routes via dark theme dropdowns, saves, and verifies independent persistence", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Start connected fixture project; choose matching Settings profile and expand Native Advisor; enable toggle
    await page.goto(`${appServices.appOrigin}/settings`);
    // Choose matching Settings profile
    const targetSelect = page.locator("#settings-target-select");
    await expect(targetSelect).toBeVisible({ timeout: 15_000 });
    const options = await targetSelect.locator("option").all();
    if (options.length > 1) {
      const val = await options[1].getAttribute("value");
      if (val) {
        await targetSelect.selectOption(val);
      }
    }

    // Expand Native Advisor accordion
    const advisorAccordionBtn = page.locator(
      "button:has-text('Native Advisor')",
    );
    await expect(advisorAccordionBtn).toBeVisible({ timeout: 15_000 });
    await advisorAccordionBtn.click();

    // Toggle switch: initially disabled
    const toggleSwitch = page.locator(
      'button[aria-label="Toggle native advisor"]',
    );
    await expect(toggleSwitch).toBeVisible({ timeout: 10_000 });
    await expect(toggleSwitch).toHaveAttribute("aria-checked", "false");

    await toggleSwitch.click();
    await expect(toggleSwitch).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid="advisor-state-badge"]'),
    ).toHaveText("Enabled");
    // Record initial policy revision after enabling advisor
    const initialApiRes = await appServices.fetchApi(
      "/api/advisor/policy/current",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(initialApiRes.status).toBe(200);
    const initialData = (await initialApiRes.json()) as { revision: string };
    const initialRevision = initialData.revision;


    // 2. Navigate /workspace, click ActivityBar "Advisor", then in-panel Configuration tab
    await page.goto(`${appServices.appOrigin}/workspace`);

    const advisorActivityBtn = page
      .locator('button[aria-label="Advisor"]')
      .first();
    await expect(advisorActivityBtn).toBeVisible({ timeout: 15_000 });
    await advisorActivityBtn.click();

    // In-panel Configuration tab
    const configTab = page.locator("#tab-configuration");
    await expect(configTab).toBeVisible({ timeout: 10_000 });
    await configTab.click();

    // Click "Edit Routing" button
    const editRoutingBtn = page.locator(
      "button.edit-routing-btn:has-text('Edit Routing')",
    );
    await expect(editRoutingBtn).toBeVisible({ timeout: 10_000 });
    await editRoutingBtn.click();

    // Form should now be visible
    const editorForm = page.locator('form[aria-label="Edit Routing Policy"]');
    await expect(editorForm).toBeVisible({ timeout: 10_000 });

    // 3. Wait for real model catalog readiness and verify dark theme presentation
    const primaryBackend = page.locator("#primary-backend");
    const primaryModel = page.locator("#primary-model-select");
    const primaryEffort = page.locator("#primary-effort");

    const backupBackend = page.locator("#backup-backend");
    const backupModel = page.locator("#backup-model-select");
    const backupEffort = page.locator("#backup-effort");

    await expect(primaryBackend).toBeVisible();
    await expect(primaryModel).toBeVisible();
    await expect(primaryEffort).toBeVisible();
    await expect(backupBackend).toBeVisible();
    await expect(backupModel).toBeVisible();
    await expect(backupEffort).toBeVisible();

    // Check dark theme styling (not default white background)
    const primaryBg = await primaryBackend.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    expect(primaryBg).not.toBe("rgb(255, 255, 255)");

    // Select distinct valid primary and backup routes
    // Primary: codex / gpt-6.1-sol / high
    await primaryBackend.selectOption("codex");
    await expect(
      primaryModel.locator('option[value="gpt-6.1-sol"]'),
    ).toBeAttached({ timeout: 10_000 });
    await primaryModel.selectOption("gpt-6.1-sol");
    await primaryEffort.selectOption("high");

    // Backup: claude / sonnet / medium
    await backupBackend.selectOption("claude");
    await expect(backupModel.locator('option[value="sonnet"]')).toBeAttached({
      timeout: 10_000,
    });
    await backupModel.selectOption("sonnet");
    await backupEffort.selectOption("medium");
    // 4. Capture editor inside application shell at meaningful ready checkpoint
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });

    // 5. Save Routing; verify displayed committed values
    const saveBtn = page.locator(
      'button.save-routing-btn:has-text("Save Routing")',
    );
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await saveBtn.click();

    // Editor form closes, returning to read-only summary card
    await expect(editorForm).toBeHidden({ timeout: 10_000 });
    await expect(editRoutingBtn).toBeVisible({ timeout: 10_000 });

    // 6. Independent authenticated API read
    const apiRes = await appServices.fetchApi("/api/advisor/policy/current", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(apiRes.status).toBe(200);
    const apiData = (await apiRes.json()) as {
      revision: string;
      policy?: {
        advisor: {
          primary: { backend: string; model: string; effort: string };
          backup: { backend: string; model: string; effort: string };
        };
        wait: { mode: string };
        history: { retentionDays?: number; retention_days?: number };
      };
    };

    // Assert committed revision changed from initial
    expect(apiData.revision).not.toBe(initialRevision);
    expect(apiData.policy?.advisor.primary.backend).toBe("codex");
    expect(apiData.policy?.advisor.primary.model).toBe("gpt-6.1-sol");
    expect(apiData.policy?.advisor.primary.effort).toBe("high");
    expect(apiData.policy?.advisor.backup.backend).toBe("claude");
    expect(apiData.policy?.advisor.backup.model).toBe("sonnet");
    expect(apiData.policy?.advisor.backup.effort).toBe("medium");
    expect(apiData.policy?.wait.mode).toBe("until_terminal");
    expect(
      apiData.policy?.history.retentionDays ??
        apiData.policy?.history.retention_days,
    ).toBe(30);

    // 7. Independent disk policy file read
    const diskPolicy = (await appServices.readPolicyFile()) as {
      advisor: {
        primary: { backend: string; model: string; effort: string };
        backup: { backend: string; model: string; effort: string };
      };
      wait: { mode: string };
      history: { retention_days?: number; retentionDays?: number };
    };

    expect(diskPolicy.advisor.primary.backend).toBe("codex");
    expect(diskPolicy.advisor.primary.model).toBe("gpt-6.1-sol");
    expect(diskPolicy.advisor.primary.effort).toBe("high");
    expect(diskPolicy.advisor.backup.backend).toBe("claude");
    expect(diskPolicy.advisor.backup.model).toBe("sonnet");
    expect(diskPolicy.advisor.backup.effort).toBe("medium");
    expect(diskPolicy.wait.mode).toBe("until_terminal");
    expect(
      diskPolicy.history.retention_days ?? diskPolicy.history.retentionDays,
    ).toBe(30);
    // 8. Browser reload/reopen retains saved values
    await page.reload();

    // Re-open Advisor panel & config tab (accommodating persisted right-panel state)
    try {
      await expect(configTab).toBeVisible({ timeout: 2500 });
    } catch {
      await expect(advisorActivityBtn).toBeVisible({ timeout: 15_000 });
      await advisorActivityBtn.click();
      await expect(configTab).toBeVisible({ timeout: 15_000 });
    }
    await configTab.click();

    // Verify summary card still shows codex & claude routes
    await expect(page.locator(".policy-card")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".policy-card")).toContainText("codex");
    await expect(page.locator(".policy-card")).toContainText("claude");
  });
});

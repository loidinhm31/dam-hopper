import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import type { SessionInfo } from "../../src/api/client.js";
import { test, expect, type ApplicationServices } from "../fixtures/application-fixture.js";
import { startApplicationServices } from "../fixtures/application-services.js";
import { waitForHealth } from "../fixtures/application-readiness.js";
import { createBrowserStorageState } from "../fixtures/application-data.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { execInContainer, runEngine } from "../fixtures/container-client.js";
const CASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const settingsHeading = "Agent Status & Notification Settings";
const emptyRoster = "No observed agents in open terminals. OMP, Codex and Claude appear after supported integrations report status.";

async function sessions(services: ApplicationServices): Promise<SessionInfo[]> {
  const response = await services.fetchApi("/api/terminal/detailed");
  expect(response.ok).toBe(true);
  return response.json();
}

async function expectTouchTarget(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

test.describe("Traditional Projects + Agents — authenticated real application", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ servicesConfig: { authBackend: "sqlite" } });

  // This fixture has shells, not provisioned harnesses. Captures prove navigation only.
  test("keeps shell PTYs and split layout through project and compact navigation", async ({ appServices, authenticatedPage: page }) => {
    await page.goto(`${appServices.appOrigin}/workspace`);
    await page.getByTestId("top-nav-workspace-mode-switch").getByRole("button", { name: "Terminal", exact: true }).click();
    await page.getByRole("button", { name: /^traditional$/i }).click();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^fixture-project\b/ }).click();
    await page.getByRole("button", { name: "Open terminal in fixture-project", exact: true }).click();

    const navigator = page.getByRole("navigation", { name: "Terminal projects and agents", exact: true });
    await expect(navigator.getByRole("heading", { name: "projects", exact: true })).toBeVisible();
    await expect(navigator.getByRole("heading", { name: "agents", exact: true })).toBeVisible();
    await expect(navigator.getByText(emptyRoster, { exact: true })).toBeVisible();
    await expect(navigator.getByRole("list", { name: "Observed agents in open terminals" })).toHaveCount(0);
    const firstTerminal = page.locator(".xterm:visible").first();
    await expect(firstTerminal).toBeVisible();
    const retainedTerminal = await firstTerminal.elementHandle();
    await firstTerminal.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf 'traditional-shell-continuity\\n'");
    await page.keyboard.press("Enter");
    const original = (await sessions(appServices)).find((session) => session.project === "fixture-project")!;
    expect(original.alive).toBe(true);
    const bufferPath = `/api/terminal/${encodeURIComponent(original.id)}/buffer`;
    await expect.poll(async () => (await (await appServices.fetchApi(bufferPath)).json()).buffer).toContain("traditional-shell-continuity");

    await page.getByTitle("Split Right (Ctrl+Shift+5)", { exact: true }).click();
    await expect(page.getByTestId("terminal-pane-output-host")).toHaveCount(2);
    await navigator.getByRole("button", { name: "New terminal in selected project", exact: true }).click();
    await expect.poll(async () => (await sessions(appServices)).filter((session) => session.project === "fixture-project").length).toBe(2);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: new RegExp(`^${appServices.secondaryProjectName}\\b`) }).click();
    await page.getByRole("button", { name: `Open terminal in ${appServices.secondaryProjectName}`, exact: true }).click();
    await navigator.getByRole("tab", { name: /fixture-project\b/ }).click();
    await expect(page.getByTestId("terminal-pane-output-host")).toHaveCount(2);
    expect(await retainedTerminal!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(navigator.getByText(emptyRoster, { exact: true })).toBeVisible();
    const profileId = await page.evaluate(() => localStorage.getItem("damhopper_active_profile_id"));
    expect(profileId).not.toBeNull();
    const settingsHref = `/agent-store?tab=settings&profileId=${encodeURIComponent(profileId!)}`;
    await expect(navigator.getByRole("link", { name: "Agent Settings", exact: true })).toHaveAttribute("href", settingsHref);
    await captureApplicationCheckpoint(page, { caseDir: CASE_DIR });

    await page.setViewportSize({ width: 390, height: 844 });
    const opener = page.getByRole("button", { name: "Projects + Agents", exact: true });
    const sheet = page.getByRole("dialog", { name: "Projects + Agents", exact: true });
    await expectTouchTarget(opener);
    await expect(page.getByTestId("terminal-pane-output-host")).toHaveCount(2);
    await expect(page.locator(".xterm:visible").first()).toBeVisible();
    // Catch disposal at the breakpoint itself, not only after returning wide.
    expect(await retainedTerminal!.evaluate((element) => element.isConnected)).toBe(true);
    await opener.click();
    await expect(sheet.getByRole("heading", { name: "projects", exact: true })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "agents", exact: true })).toBeVisible();
    await expect(sheet.getByText(emptyRoster, { exact: true })).toBeVisible();
    for (const control of [sheet.getByRole("button", { name: "Close", exact: true }), sheet.getByRole("button", { name: "New terminal in selected project", exact: true }), sheet.getByRole("link", { name: "Agent Settings", exact: true })]) {
      await expectTouchTarget(control);
    }
    const tabs = sheet.getByRole("tab");
    for (let index = 0; index < await tabs.count(); index++) await expectTouchTarget(tabs.nth(index));
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press(key);
        expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
    }
    // Rapid Shift+Tab must not activate the workspace's DoubleShift search.
    await expect(page.getByPlaceholder(/^(?:Find files |Search (?:project target contents|across all connected profiles))/)).toHaveCount(0);
    await captureApplicationCheckpoint(page, { caseDir: CASE_DIR, checkpointName: "compact" });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await sheet.getByRole("tab", { name: /fixture-project\b/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await sheet.getByRole("tab", { name: /fixture-project\b/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("terminal-pane-output-host")).toHaveCount(2);
    expect(await retainedTerminal!.evaluate((element) => element.isConnected)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("terminal-pane-output-host")).toHaveCount(2);
    const current = (await sessions(appServices)).find((session) => session.id === original.id)!;
    expect(current.incarnation).toBe(original.incarnation);
    expect(current.alive).toBe(true);
    expect(await retainedTerminal!.evaluate((element) => element.isConnected)).toBe(true);
    expect((await (await appServices.fetchApi(bufferPath)).json()).buffer).toContain("traditional-shell-continuity");
    await navigator.getByRole("link", { name: "Agent Settings", exact: true }).click();
    await expect(page).toHaveURL(`${appServices.appOrigin}${settingsHref}`);
    await expect(page.getByLabel("Profile:", { exact: true })).toHaveValue(profileId!);
    await expect(page.getByRole("heading", { name: settingsHeading, exact: true })).toBeVisible();
  });

  test("targets real B while active A and denies unresolved or disconnected owners", async ({ appServices, browser }) => {
    const secondary = await startApplicationServices({ authBackend: "sqlite" });
    try {
      const serverPid = (await execInContainer(secondary.appContainerId, ["pidof", "dam-hopper-server"])).trim();
      await execInContainer(secondary.appContainerId, [
        "/bin/sh", "-c",
        'kill -TERM "$1"; attempts=0; while kill -0 "$1" 2>/dev/null; do attempts=$((attempts + 1)); [ "$attempts" -lt 300 ] || exit 1; sleep 0.1; done',
        "stop", serverPid,
      ]);
      await runEngine([
        "exec", "-d", "-e", "HOME=/e2e/home", "-e", "XDG_CONFIG_HOME=/e2e/home/.config",
        "-e", "XDG_DATA_HOME=/e2e/home/.local/share", "-e", "XDG_STATE_HOME=/e2e/home/.local/state",
        "-e", "TMPDIR=/e2e/tmp", "-e", "DAM_HOPPER_LITE_MODE=true",
        "-e", "DAM_HOPPER_AUTH_SQLITE_PATH=/e2e/home/.config/dam-hopper/auth.db",
        "-e", "DAM_HOPPER_MFA_KEY_FILE=/e2e/home/mfa.key",
        secondary.appContainerId, "dam-hopper-server", "--config", "/e2e/dam-hopper.toml",
        "--workspace", "/e2e/workspace", "--host", "0.0.0.0", "--port", "4800",
        "--web-dir", "/opt/dam-hopper/web", "--cors-origins", appServices.appOrigin,
      ]);
      await waitForHealth(secondary.appOrigin);
      for (const connected of [true, false]) {
        const state = createBrowserStorageState({ appOrigin: appServices.appOrigin, profileId: "journey-A", token: appServices.token, username: appServices.username });
        const storage = state.origins[0]!.localStorage;
        const profiles = JSON.parse(storage.find((entry) => entry.name === "damhopper_server_profiles")!.value);
        profiles.push({ id: "journey-B", name: "Journey B", url: secondary.appOrigin, authType: "basic", username: secondary.username, createdAt: Date.now(), autoConnect: connected });
        storage.find((entry) => entry.name === "damhopper_server_profiles")!.value = JSON.stringify(profiles);
        if (connected) storage.push({ name: "damhopper_profile_auth_v2_journey-B", value: JSON.stringify({ version: 2, serverUrl: secondary.appOrigin, authType: "basic", token: secondary.token }) });
        const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
        try {
          const page = await context.newPage();
          const queries: string[] = [];
          page.on("request", (request) => {
            const url = new URL(request.url());
            if (/^\/api\/(agent-store(?:\/|$)|agent-status\/(paths|integrations|omp))/.test(url.pathname)) queries.push(url.origin);
          });
          const route = `${appServices.appOrigin}/agent-store?tab=settings&profileId=journey-B`;
          if (connected) {
            const ownerResponse = page.waitForResponse((response) => new URL(response.url()).origin === secondary.appOrigin && new URL(response.url()).pathname === "/api/agent-status/paths" && response.ok());
            await page.goto(route);
            await ownerResponse;
            await expect(page.getByRole("heading", { name: settingsHeading, exact: true })).toBeVisible();
            expect(queries.length).toBeGreaterThan(0);
            expect(queries.every((origin) => origin === secondary.appOrigin)).toBe(true);
          } else {
            await page.goto(route);
            await expect(page.getByText(/Profile Journey B is unavailable/)).toBeVisible();
            await expect(page.getByRole("heading", { name: settingsHeading, exact: true })).toHaveCount(0);
            expect(queries).toEqual([]);
          }
          await expect(page.getByLabel("Profile:", { exact: true })).toHaveValue("journey-B");
          expect(await page.evaluate(() => localStorage.getItem("damhopper_active_profile_id"))).toBe("journey-A");
          for (const [suffix, message] of [["", "Choose a server profile to continue."], ["&profileId=", "Invalid profile target. Choose a server profile to continue."], ["&profileId=retired-profile", "Profile retired-profile is no longer available. Choose another server profile."]] as const) {
            queries.length = 0;
            await page.goto(`${appServices.appOrigin}/agent-store?tab=settings${suffix}`);
            await expect(page.getByText(message, { exact: true })).toBeVisible();
            await expect(page.getByLabel("Profile:", { exact: true })).toHaveValue("");
            await expect(page.getByRole("heading", { name: settingsHeading, exact: true })).toHaveCount(0);
            expect(queries).toEqual([]);
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await secondary.dispose();
    }
  });
});

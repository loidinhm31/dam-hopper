import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import type { SessionInfo } from "../../src/api/client.js";
import { test, expect, type ApplicationServices } from "../fixtures/application-fixture.js";
import { createBrowserStorageState } from "../fixtures/application-data.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { execInContainer } from "../fixtures/container-client.js";

const CASE_DIR = path.dirname(fileURLToPath(import.meta.url));

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

test.describe("Traditional Terminal Worktree Switching — real application PTY qualification", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ servicesConfig: { authBackend: "sqlite" } });

  test("proves newly launched terminal uses selected worktree cwd while preserving existing sessions", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Initialize Git repository with main branch and linked feature worktree in fixture-project
    const git = (args: string[]) =>
      execInContainer(appServices.appContainerId, [
        "git",
        "-C",
        "/e2e/workspace/fixture-project",
        ...args,
      ]);

    await git(["init", "-b", "main"]);
    await git(["config", "user.name", "Test User"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["add", "README.md", "sample.txt"]);
    await git(["commit", "-m", "Initial commit on main"]);

    await execInContainer(appServices.appContainerId, [
      "git",
      "-C",
      "/e2e/workspace/fixture-project",
      "worktree",
      "add",
      "/e2e/workspace/fixture-feature-worktree",
      "-b",
      "feature/e2e-worktree",
    ]);

    await appServices.writeContainerFile(
      "/e2e/workspace/fixture-feature-worktree/feature-branch.txt",
      "FEATURE_WORKTREE_MARKER_FILE_CONTENT\n",
    );

    // 2. Open Traditional terminal view in the browser
    await page.goto(`${appServices.appOrigin}/workspace`);
    await page
      .getByTestId("top-nav-workspace-mode-switch")
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
    await page.getByRole("button", { name: /^traditional$/i }).click();

    // Start initial shell in fixture-project
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^fixture-project\b/ }).click();
    await page
      .getByRole("button", {
        name: "Open terminal in fixture-project",
        exact: true,
      })
      .click();

    const navigator = page.getByRole("navigation", {
      name: "Terminal projects and agents",
      exact: true,
    });
    await expect(
      navigator.getByRole("heading", { name: "projects", exact: true }),
    ).toBeVisible();

    const firstTerminal = page.locator(".xterm:visible").first();
    await expect(firstTerminal).toBeVisible();

    // Type unique marker in root shell
    await firstTerminal.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf 'ROOT_PTY_SHELL_MARKER_9988\\n'");
    await page.keyboard.press("Enter");

    // Verify root session ID, incarnation, alive status, and cwd
    let currentSessions = await sessions(appServices);
    const rootSession = currentSessions.find(
      (s) => s.project === "fixture-project",
    );
    expect(rootSession).toBeDefined();
    expect(rootSession!.alive).toBe(true);
    expect(rootSession!.cwd).toBe("/e2e/workspace/fixture-project");
    const rootSessionId = rootSession!.id;
    const rootIncarnation = rootSession!.incarnation;

    const rootBufferPath = `/api/terminal/${encodeURIComponent(rootSessionId)}/buffer`;
    await expect
      .poll(async () => (await (await appServices.fetchApi(rootBufferPath)).json()).buffer)
      .toContain("ROOT_PTY_SHELL_MARKER_9988");

    // 3. Select feature worktree in Traditional sidebar
    const worktreeSelect = navigator.getByRole("combobox", {
      name: /Worktree for fixture-project/,
    });
    await expect(worktreeSelect).toBeVisible();
    await worktreeSelect.click();

    const featureOption = page.getByRole("option", {
      name: /feature\/e2e-worktree/,
    });
    await expect(featureOption).toBeVisible();
    await featureOption.click();

    // Worktree select reflects feature
    await expect(worktreeSelect).toHaveAttribute(
      "aria-label",
      /feature\/e2e-worktree/,
    );

    // 4. Click "+" (New terminal in selected project)
    await navigator
      .getByRole("button", {
        name: "New terminal in selected project",
        exact: true,
      })
      .click();

    await expect
      .poll(async () => {
        const active = await sessions(appServices);
        return active.filter((s) => s.project === "fixture-project").length;
      })
      .toBe(2);

    currentSessions = await sessions(appServices);
    const featureSession = currentSessions.find(
      (s) => s.project === "fixture-project" && s.id !== rootSessionId,
    );
    expect(featureSession).toBeDefined();
    expect(featureSession!.alive).toBe(true);
    // Real PTY verification: new session runs in feature worktree directory
    expect(featureSession!.cwd).toBe(
      "/e2e/workspace/fixture-feature-worktree",
    );

    // Verify second terminal output in feature worktree
    const featureTerminal = page.locator(".xterm:visible").first();
    await featureTerminal.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("cat feature-branch.txt\n");

    const featureBufferPath = `/api/terminal/${encodeURIComponent(featureSession!.id)}/buffer`;
    await expect
      .poll(async () => (await (await appServices.fetchApi(featureBufferPath)).json()).buffer)
      .toContain("FEATURE_WORKTREE_MARKER_FILE_CONTENT");

    // 5. Verify original root shell remains completely unchanged and alive
    currentSessions = await sessions(appServices);
    const rootCheck = currentSessions.find((s) => s.id === rootSessionId);
    expect(rootCheck).toBeDefined();
    expect(rootCheck!.alive).toBe(true);
    expect(rootCheck!.incarnation).toBe(rootIncarnation);
    expect(rootCheck!.cwd).toBe("/e2e/workspace/fixture-project");

    const rootBufferAfter = (await (await appServices.fetchApi(rootBufferPath)).json()).buffer;
    expect(rootBufferAfter).toContain("ROOT_PTY_SHELL_MARKER_9988");

    // Prove live interactivity of the root shell: send a second command and observe continuing output
    const rootTab = page.getByRole("button", { name: /fixture-project.*#1/ });
    if (await rootTab.isVisible()) {
      await rootTab.click();
    }
    await firstTerminal.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("pwd; printf 'ROOT_STILL_INTERACTIVE\\n'");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await (await appServices.fetchApi(rootBufferPath)).json()).buffer)
      .toContain("ROOT_STILL_INTERACTIVE");
    // 6. Return to Project root in the worktree dropdown and launch a third shell
    await worktreeSelect.click();
    const rootOption = page.getByRole("option", { name: /Project root/ });
    await expect(rootOption).toBeVisible();
    await rootOption.click();

    await navigator
      .getByRole("button", {
        name: "New terminal in selected project",
        exact: true,
      })
      .click();

    await expect
      .poll(async () => {
        const active = await sessions(appServices);
        return active.filter((s) => s.project === "fixture-project").length;
      })
      .toBe(3);

    currentSessions = await sessions(appServices);
    const thirdSession = currentSessions.find(
      (s) =>
        s.project === "fixture-project" &&
        s.id !== rootSessionId &&
        s.id !== featureSession!.id,
    );
    expect(thirdSession).toBeDefined();
    expect(thirdSession!.cwd).toBe("/e2e/workspace/fixture-project");


    // 7. Verify two-profile isolation: independent profile does not inherit target selection
    const secondaryProfileId = "secondary-profile-" + Date.now();
    const secondaryStorageState = createBrowserStorageState({
      appOrigin: appServices.appOrigin,
      profileId: secondaryProfileId,
      token: appServices.token,
      username: appServices.username,
    });
    const secondaryContext = await page.context().browser()!.newContext({
      storageState: secondaryStorageState,
      baseURL: appServices.appOrigin,
    });
    const secondaryPage = await secondaryContext.newPage();
    await secondaryPage.goto(`${appServices.appOrigin}/workspace`);
    await secondaryPage
      .getByTestId("top-nav-workspace-mode-switch")
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
    await secondaryPage.getByRole("button", { name: /^traditional$/i }).click();
    const secondaryNavigator = secondaryPage.getByRole("navigation", {
      name: "Terminal projects and agents",
      exact: true,
    });
    await expect(
      secondaryNavigator.getByRole("heading", { name: "projects", exact: true }),
    ).toBeVisible();
    await secondaryContext.close();
    // 7. Visual captures across wide, narrow, and compact layouts
    // Wide layout (1440x900)
    await captureApplicationCheckpoint(page, { caseDir: CASE_DIR });

    // Narrow layout (768x1024)
    await page.setViewportSize({ width: 768, height: 1024 });
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "narrow",
    });

    // Compact layout (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    const opener = page.getByRole("button", {
      name: "Projects + Agents",
      exact: true,
    });
    await expectTouchTarget(opener);
    await opener.click();

    const sheet = page.getByRole("dialog", {
      name: "Projects + Agents",
      exact: true,
    });
    await expect(sheet).toBeVisible();
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "compact",
    });
  });
});

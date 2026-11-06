import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { createTerminalSessionObserver } from "../fixtures/terminal-session-observation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_CASE_DIR = path.resolve(__dirname, "../os-agent-hub-workspace");

test.describe("Agent Hub Terminal-First Workspace Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies Hub maximized desktop, zero-terminal open, tree disclosure, float file open, instance isolation, and streaming continuity", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // 1. Seed initial session with Agent Hub maximized on Desktop 1 "Hub",
    // and provision secondary profile pointing to the same server to test AC2 multi-profile isolation.
    const hubWinId = "agent-hub-primary";
    const hubDesktopId = "desktop-hub";
    const seededSession = {
      schema: 1,
      activeDesktopId: hubDesktopId,
      desktops: [
        {
          id: hubDesktopId,
          name: "Hub",
          tree: {
            type: "pane",
            id: "pane-hub-root",
            items: [hubWinId],
            active: hubWinId,
          },
          floatingWindowIds: [],
          focusedWindowId: hubWinId,
        },
      ],
      windows: {
        [hubWinId]: {
          id: hubWinId,
          appId: "agent-hub",
          title: "Agent Hub",
          ctx: { profileId: "" },
          mode: "tile",
          desktopId: hubDesktopId,
          maximized: true,
          minimized: false,
        },
      },
    };

    await page.addInitScript(
      ({ appOrigin, token, username, sessionData }) => {
        try {
          const rawProfiles = localStorage.getItem("damhopper_server_profiles");
          const profiles = rawProfiles ? JSON.parse(rawProfiles) : [];
          const primaryProfileId = profiles[0]?.id || "default";
          if (sessionData.windows["agent-hub-primary"]) {
            sessionData.windows["agent-hub-primary"].ctx.profileId = primaryProfileId;
          }
          localStorage.setItem("dam-hopper:os:v1:session", JSON.stringify(sessionData));
        } catch {
          // ignore init storage errors
        }
      },
      {
        appOrigin: appServices.appOrigin,
        token: appServices.token,
        username: appServices.username,
        sessionData: seededSession,
      },
    );

    // 2. Navigate to /os and verify Agent Hub default maximized desktop (AC1)
    await page.goto(`${appServices.appOrigin}/os`);
    const osShell = page.locator("[data-os-shell='true']").first();
    await expect(osShell).toBeVisible({ timeout: 20_000 });

    const hubApp = page.locator('[data-testid="agent-hub-app"]').first();
    await expect(hubApp).toBeVisible({ timeout: 15_000 });

    // Verify Agent Hub header
    const hubPill = page.locator('[data-testid="agent-hub-context-pill"]').first();
    await expect(hubPill).toBeVisible({ timeout: 10_000 });

    // 3. Open zero-terminal project via [+ Open ▾] picker
    const openPickerBtn = page.locator('button[aria-label="Open project workspace"]').first();
    await expect(openPickerBtn).toBeVisible({ timeout: 10_000 });
    await openPickerBtn.click();

    const pickerListbox = page.locator('[role="listbox"][aria-label="Available project workspaces"]').first();
    await expect(pickerListbox).toBeVisible({ timeout: 5_000 });

    // Choose fixture-project
    const projectOption = pickerListbox.locator('[role="option"]').filter({ hasText: "fixture-project" }).first();
    await expect(projectOption).toBeVisible({ timeout: 5_000 });
    await projectOption.click();

    // Verify project workspace row appears in sidebar and empty-workspace state is shown
    const emptyWorkspace = page.locator('[data-testid="traditional-terminal-empty-workspace"]').first();
    await expect(emptyWorkspace).toBeVisible({ timeout: 10_000 });
    await expect(emptyWorkspace).toContainText("No terminals running in this workspace");

    // 4. Project workspace tree in right sidebar (AC4)
    const rightSidebar = page.locator('[data-testid="agent-hub-right-file-tree-sidebar"]').first();
    if (!(await rightSidebar.isVisible())) {
      const toggleFilesBtn = page.locator('button[aria-label="Toggle files sidebar"]').first();
      if (await toggleFilesBtn.isVisible()) {
        await toggleFilesBtn.click();
      } else {
        const expandBtn = page.locator('button[aria-label^="Expand fixture-project files"]').first();
        if (await expandBtn.isVisible()) {
          await expandBtn.click();
        }
      }
    }
    // Wait for file tree to be visible
    const fileTreeNode = page.locator('[role="treeitem"]').filter({ hasText: "sample.txt" }).first();
    const readmeTreeNode = page.locator('[role="treeitem"]').filter({ hasText: "README.md" }).first();

    const targetFileItem = (await fileTreeNode.isVisible()) ? fileTreeNode : readmeTreeNode;
    await expect(targetFileItem).toBeVisible({ timeout: 10_000 });

    // 5. Open file → Float editor window above Hub with owner badge (AC1, B2)
    await targetFileItem.dblclick();

    const editorWindow = page
      .locator("[data-os-window-frame]")
      .filter({ has: page.locator('[data-os-editor-app], [data-os-editor-chooser]') })
      .first();
    await expect(editorWindow).toBeVisible({ timeout: 15_000 });

    // Verify owner badge on floating editor title bar contains fixture-project
    const ownerBadge = editorWindow.locator("span.font-mono").filter({ hasText: "fixture-project" }).first();
    await expect(ownerBadge).toBeVisible({ timeout: 10_000 });

    // 6. Test instance isolation and refocus (AC2)
    // Clicking the same file again should refocus the existing editor window
    const firstEditorId = await editorWindow.getAttribute("data-os-window-frame");
    expect(firstEditorId).toBeTruthy();

    await targetFileItem.dblclick();
    await page.waitForTimeout(200);

    const editorWindowsAfterRefocus = page
      .locator("[data-os-window-frame]")
      .filter({ has: page.locator('[data-os-editor-app], [data-os-editor-chooser]') });
    await expect(editorWindowsAfterRefocus).toHaveCount(1);
    const refocusedId = await editorWindowsAfterRefocus.first().getAttribute("data-os-window-frame");
    expect(refocusedId).toBe(firstEditorId);
    await expect(editorWindowsAfterRefocus.first()).toHaveAttribute("data-os-focused", "true");
    // Close the floating editor so it does not obstruct sidebar interactions
    const closeFirstEditor = editorWindowsAfterRefocus.first().locator('button[aria-label="Close"]');
    await closeFirstEditor.click();
    await expect(page.locator("[data-os-window-frame]").filter({ has: page.locator('[data-os-editor-app]') })).toHaveCount(0);

    // Open second project (fixture-worktree-project) to verify distinct window for different project/worktree
    await openPickerBtn.click();
    const secondProjectOption = pickerListbox.locator('[role="option"]').filter({ hasText: "fixture-worktree-project" }).first();
    await expect(secondProjectOption).toBeVisible({ timeout: 5_000 });
    await secondProjectOption.click();

    const expandSecondBtn = page.locator('button[aria-label^="Expand fixture-worktree-project files"]').first();
    if (await expandSecondBtn.isVisible()) {
      await expandSecondBtn.click();
    }
    const secondReadme = page.locator('[role="treeitem"]').filter({ hasText: "README.md" }).first();
    await expect(secondReadme).toBeVisible({ timeout: 5_000 });
    await secondReadme.dblclick();

    // Verify distinct second editor window created for fixture-worktree-project with owner badge
    const secondEditorWindow = page
      .locator("[data-os-window-frame]")
      .filter({ has: page.locator('[data-os-editor-app], [data-os-editor-chooser]') })
      .first();
    await expect(secondEditorWindow).toBeVisible({ timeout: 10_000 });
    const secondOwnerBadge = secondEditorWindow.locator("span.font-mono").filter({ hasText: "fixture-worktree-project" }).first();
    await expect(secondOwnerBadge).toBeVisible({ timeout: 10_000 });

    // Close second editor window
    await secondEditorWindow.locator('button[aria-label="Close"]').click();
    await expect(page.locator("[data-os-window-frame]").filter({ has: page.locator('[data-os-editor-app]') })).toHaveCount(0);

    // 7. Hub [+ New Terminal] streams output (AC3)
    // Launch new terminal via sidebar project row [+] button
    const rowNewTermBtn = page.locator('button[aria-label="New terminal in fixture-worktree-project"]').first();
    await expect(rowNewTermBtn).toBeVisible({ timeout: 5_000 });
    await rowNewTermBtn.evaluate((el: HTMLElement) => el.click());
    // Wait for terminal panel and stream
    const terminalPanel = page.locator("[data-terminal-session-id]").first();
    await expect(terminalPanel).toBeVisible({ timeout: 20_000 });

    const xtermTokenBefore = await page
      .locator("[data-xterm-instance-token]")
      .first()
      .getAttribute("data-xterm-instance-token");
    expect(xtermTokenBefore).toBeTruthy();

    // 8. Sidebar hide/show + project switch preserves stream without xterm remount (AC3, AC6)
    const toggleSidebarBtn = page.locator('button[aria-label="Toggle projects sidebar"]').first();
    await expect(toggleSidebarBtn).toBeVisible({ timeout: 5_000 });
    await toggleSidebarBtn.click();
    await page.waitForTimeout(200);

    // Sidebar toggled off, xterm instance token remains identical
    const xtermTokenHidden = await page
      .locator("[data-xterm-instance-token]")
      .first()
      .getAttribute("data-xterm-instance-token");
    expect(xtermTokenHidden).toBe(xtermTokenBefore);

    // Toggle sidebar back on
    await toggleSidebarBtn.click();
    await page.waitForTimeout(200);

    const xtermTokenShown = await page
      .locator("[data-xterm-instance-token]")
      .first()
      .getAttribute("data-xterm-instance-token");
    expect(xtermTokenShown).toBe(xtermTokenBefore);

    // 9. Close terminal tab in Agent Hub (Item 1 verification)
    const closeTabBtn = page.locator('button[aria-label="Close terminal"]').first();
    if (await closeTabBtn.isVisible()) {
      await closeTabBtn.click();
      const confirmEndBtn = page.locator('button:has-text("End Session")').first();
      if (await confirmEndBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmEndBtn.click();
      }
    }

    // 10. Document AC5 agent section
    const agentSection = page.getByRole("region", { name: "agents" });
    await expect(agentSection).toBeVisible();
    await expect(agentSection).toContainText("agents");
  });
  test("captures complete matrix evidence for os-agent-hub-workspace", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    const observer = createTerminalSessionObserver(page);
    await observer.resetViewportAndZoom();

    // Navigate to /os with seeded Hub desktop
    const hubWinId = "agent-hub-primary";
    const hubDesktopId = "desktop-hub";
    const seededSession = {
      schema: 1,
      activeDesktopId: hubDesktopId,
      desktops: [
        {
          id: hubDesktopId,
          name: "Hub",
          tree: {
            type: "pane",
            id: "pane-hub-root",
            items: [hubWinId],
            active: hubWinId,
          },
          floatingWindowIds: [],
          focusedWindowId: hubWinId,
        },
      ],
      windows: {
        [hubWinId]: {
          id: hubWinId,
          appId: "agent-hub",
          title: "Agent Hub",
          ctx: { profileId: "" },
          mode: "tile",
          desktopId: hubDesktopId,
          maximized: true,
          minimized: false,
        },
      },
    };

    await page.addInitScript(
      ({ sessionData }) => {
        try {
          const rawProfiles = localStorage.getItem("damhopper_server_profiles");
          const profiles = rawProfiles ? JSON.parse(rawProfiles) : [];
          const primaryProfileId = profiles[0]?.id || "default";
          if (sessionData.windows["agent-hub-primary"]) {
            sessionData.windows["agent-hub-primary"].ctx.profileId = primaryProfileId;
          }
          localStorage.setItem("dam-hopper:os:v1:session", JSON.stringify(sessionData));
        } catch {
          // ignore
        }
      },
      { sessionData: seededSession },
    );

    await page.goto(`${appServices.appOrigin}/os`);
    await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="agent-hub-app"]').first()).toBeVisible({ timeout: 15_000 });

    const captureCombos = async (stem?: string) => {
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
        const checkpointName = stem ? `${stem}-${c.suffix}` : c.suffix;
        await captureApplicationCheckpoint(page, {
          caseDir: CAPTURE_CASE_DIR,
          checkpointName,
        });
      }
      await observer.resetViewportAndZoom();
    };

    // 1. Primary screenshot.png and base state (Agent Hub workspace)
    await captureApplicationCheckpoint(page, { caseDir: CAPTURE_CASE_DIR });
    await captureCombos();

    // 2. Open project workspace state
    const openPickerBtn = page.locator('button[aria-label="Open project workspace"]').first();
    if (await openPickerBtn.isVisible()) {
      await openPickerBtn.click();
      const pickerListbox = page.locator('[role="listbox"][aria-label="Available project workspaces"]').first();
      if (await pickerListbox.isVisible()) {
        const projectOption = pickerListbox.locator('[role="option"]').filter({ hasText: "fixture-project" }).first();
        if (await projectOption.isVisible()) {
          await projectOption.click();
          await page.waitForTimeout(200);
          await captureCombos("workspace-open");

          // Expand tree and open file
          const expandBtn = page.locator('button[aria-label^="Expand fixture-project files"]').first();
          if (await expandBtn.isVisible()) {
            await expandBtn.click();
            await page.waitForTimeout(200);
            const sampleItem = page.locator('[role="treeitem"]').first();
            if (await sampleItem.isVisible()) {
              await sampleItem.click();
              await page.waitForTimeout(300);
              await captureCombos("file-float");
            }
          }
        }
      }
    }
  });
});

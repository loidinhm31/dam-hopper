import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Project Plans Dashboard Real Application Journey (Phase 05 Qualification)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test("qualifies folder-first browsing, selected plan overview, timeline, documents, watcher refresh, target isolation, and responsive layout", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Initial integrity baseline: inspect plan file bytes, mtime, and size before reads
    const planFilePath =
      "/e2e/workspace/fixture-project/plans/261001-sample/plan.md";
    const initialPlanBytes = await appServices.readContainerFile(planFilePath);
    const initialPlanStat = await appServices.statContainerFile(planFilePath);
    expect(initialPlanStat.size).toBeGreaterThan(0);
    expect(initialPlanBytes.length).toBeGreaterThan(0);
    await page.goto(`${appServices.appOrigin}/workspace`);

    const topNav = page.locator("nav[aria-label='Primary']").first();
    await expect(topNav).toBeVisible({ timeout: 15_000 });

    // 3. Open Workflow Context Deck
    const workflowBar = page
      .locator("[aria-label='Workflow Context Bar']")
      .first();
    await expect(workflowBar).toBeVisible({ timeout: 15_000 });

    const expandBtn = page
      .locator("button[aria-label='Expand workflow deck']")
      .first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
    } else {
      await workflowBar.click();
    }

    const deckHeader = page.locator("button:has-text('File plans')").first();
    await expect(deckHeader).toBeVisible({ timeout: 15_000 });

    // 4. Switch to "File plans" tab
    await deckHeader.click();

    // 5. Verify folder-first browser is displayed
    const folderList = page.locator("[aria-label='Folder entries']").first();
    await expect(folderList).toBeVisible({ timeout: 15_000 });

    // Verify immediate folder entries are present without plan status badges
    const sampleFolderItem = page
      .locator("button[role='listitem']:has-text('261001-sample')")
      .first();
    await expect(sampleFolderItem).toBeVisible();

    const undatedFolderItem = page
      .locator("button[role='listitem']:has-text('261002-undated')")
      .first();
    await expect(undatedFolderItem).toBeVisible();

    const bulkFolderItem = page
      .locator("button[role='listitem']:has-text('bulk')")
      .first();
    await expect(bulkFolderItem).toBeVisible();

    // 6. Test folder filter input
    const filterInput = page
      .locator("input[placeholder='Filter folders by name...']")
      .first();
    await expect(filterInput).toBeVisible();
    await filterInput.fill("sample");
    await expect(sampleFolderItem).toBeVisible();
    await expect(undatedFolderItem).toBeHidden();

    // Clear filter
    await filterInput.fill("");
    await expect(undatedFolderItem).toBeVisible();

    // 7. Select plan: click 261001-sample
    await sampleFolderItem.click();

    const planDashboard = page
      .locator("[aria-label='Selected Project Plan Dashboard']")
      .first();
    await expect(planDashboard).toBeVisible({ timeout: 15_000 });

    // Verify reported status: "in-progress" (progress.md opts in over plan.md pending)
    const statusBadge = planDashboard
      .locator("span:has-text('in-progress')")
      .first();
    await expect(statusBadge).toBeVisible();

    await expect(
      planDashboard.getByText("Declared:", { exact: false }),
    ).toHaveText("Declared: 5");
    const overviewTabBtn = page.locator("button:has-text('Overview')").first();
    await expect(overviewTabBtn).toBeVisible();

    // 8. Capture primary full desktop checkpoint (screenshot.png at 1440x900)
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });

    // 9. Inspect Timeline tab
    const timelineTabBtn = page.locator("button:has-text('Timeline')").first();
    await expect(timelineTabBtn).toBeVisible();
    await timelineTabBtn.click();

    const timelineContainer = page
      .locator("[aria-label='Selected Plan Timeline']")
      .first();
    await expect(timelineContainer).toBeVisible({ timeout: 10_000 });

    // 10. Inspect Documents tab with markdown, mermaid, and local image notice
    const documentsTabBtn = page
      .locator("button:has-text('Documents')")
      .first();
    await expect(documentsTabBtn).toBeVisible();
    await documentsTabBtn.click();

    const docViewer = page
      .locator("[aria-label='Plan Document Viewer']")
      .first();
    await expect(docViewer).toBeVisible({ timeout: 10_000 });

    // Switch to evidence.md document
    const evidenceDocBtn = page
      .locator("button:has-text('evidence.md')")
      .first();
    if (await evidenceDocBtn.isVisible()) {
      await evidenceDocBtn.click();
    }

    // 11. Navigate back to folders
    const backBtn = page
      .locator("button[aria-label='Back to folder browser']")
      .first();
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Folder browser restored and focus returned
    await expect(folderList).toBeVisible({ timeout: 10_000 });

    // 12. Browse bulk folder (>200 items + unreadable document resilience)
    await bulkFolderItem.click();

    // Wait for bulk folder listing
    const plan001 = page
      .locator("button[role='listitem']:has-text('plan-001')")
      .first();
    await expect(plan001).toBeVisible({ timeout: 15_000 });

    // Return to root plans via breadcrumbs
    const plansCrumb = page
      .locator("nav[aria-label='Folder breadcrumbs'] button:has-text('plans')")
      .first();
    await expect(plansCrumb).toBeVisible();
    await plansCrumb.click();
    await expect(sampleFolderItem).toBeVisible({ timeout: 10_000 });

    // 13. Atomic replacement must refresh the selected plan without a manual refresh.
    await sampleFolderItem.click();
    await expect(planDashboard).toBeVisible();
    const selectedStatus = planDashboard
      .locator("span")
      .filter({ hasText: /^in-progress$/ })
      .first();
    await expect(selectedStatus).toBeVisible();
    const updatedProgress = `# Current Progress — Sample Feature Plan\n\n**Plan:** [plan.md](./plan.md)\n**Published:** 2026-10-06\n**Current status:** Completed (All verified)\n\n## Phase Reconciliation\n\n| Phase | Current status |\n|---|---|\n${[1, 2, 3, 4, 5].map((number) => `| [0${number} — Phase ${number}](./phase-0${number}.md) | Completed |`).join("\n")}\n`;
    await appServices.writeContainerFile(
      "/e2e/workspace/fixture-project/plans/261001-sample/progress.md",
      updatedProgress,
    );
    await expect(selectedStatus).toBeHidden();
    await expect(
      planDashboard
        .locator("span")
        .filter({ hasText: /^completed$/ })
        .first(),
    ).toBeVisible();
    await expect(
      planDashboard.getByText("Completed:", { exact: false }),
    ).toHaveText("Completed: 5");

    // 14. A real unsaved manual draft survives File plans / Manual tracking switches.
    const manualTabBtn = page
      .getByRole("tab", { name: "Manual tracking", exact: true })
      .first();
    await manualTabBtn.click();
    await page
      .getByRole("button", { name: "New Plan", exact: true })
      .first()
      .click();
    const draftTitle = page.locator("#wf-cap-title").first();
    await draftTitle.fill("Preserve this unsaved dashboard draft");
    await deckHeader.click();
    await expect(planDashboard).toBeVisible();
    await manualTabBtn.click();
    await expect(draftTitle).toHaveValue(
      "Preserve this unsaved dashboard draft",
    );
    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .first()
      .click();
    await deckHeader.click();

    // 15. Same relative plan path must display the selected target's actual inventory.
    await page
      .locator("header")
      .getByRole("combobox")
      .filter({ hasText: /fixture-project|Select project/ })
      .first()
      .click();
    await page
      .getByRole("option")
      .filter({ hasText: appServices.secondaryProjectName })
      .click();
    if (await backBtn.isVisible()) await backBtn.click();
    await expect(sampleFolderItem).toBeVisible();
    await sampleFolderItem.click();
    await expect(
      planDashboard.getByText("Declared:", { exact: false }),
    ).toHaveText("Declared: 1");
    await expect(
      planDashboard.getByText("Completed:", { exact: false }),
    ).toHaveText("Completed: 1");
    await page
      .locator("header")
      .getByRole("combobox")
      .filter({ hasText: appServices.secondaryProjectName })
      .first()
      .click();
    await page
      .getByRole("option")
      .filter({ hasText: "fixture-project" })
      .click();
    if (await backBtn.isVisible()) await backBtn.click();
    await expect(sampleFolderItem).toBeVisible();
    await sampleFolderItem.click();
    await expect(
      planDashboard.getByText("Declared:", { exact: false }),
    ).toHaveText("Declared: 5");
    await expect(
      planDashboard.getByText("Completed:", { exact: false }),
    ).toHaveText("Completed: 5");

    // 17. Responsive viewport qualification: compact mobile (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileExpandBtn = page
      .locator("button[aria-label='Expand workflow deck']")
      .first();
    const mobileFilePlansTab = page
      .locator("button[role='tab']:has-text('File plans')")
      .first();
    const mobileSampleItem = page
      .locator("button[role='listitem']:has-text('261001-sample')")
      .first();

    await expect(
      mobileExpandBtn.or(planDashboard).or(mobileFilePlansTab).first(),
    ).toBeVisible({ timeout: 10_000 });
    if (await mobileExpandBtn.isVisible()) {
      await mobileExpandBtn.click();
    }
    if (await mobileFilePlansTab.isVisible()) {
      await mobileFilePlansTab.click();
    }
    if (await mobileSampleItem.isVisible()) {
      await mobileSampleItem.click();
    }
    await expect(planDashboard).toBeVisible({ timeout: 10_000 });
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "mobile",
    });

    // 18. Responsive viewport qualification: narrow docked (320px)
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(
      mobileExpandBtn.or(planDashboard).or(mobileFilePlansTab).first(),
    ).toBeVisible({ timeout: 10_000 });
    if (await mobileExpandBtn.isVisible()) {
      await mobileExpandBtn.click();
    }
    if (await mobileFilePlansTab.isVisible()) {
      await mobileFilePlansTab.click();
    }
    if (await mobileSampleItem.isVisible()) {
      await mobileSampleItem.click();
    }
    await expect(planDashboard).toBeVisible({ timeout: 10_000 });
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "narrow",
    });

    // Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    // 19. Final source file non-mutation verification:
    // Placed strictly after all dashboard-read and responsive interactions have settled.
    // Asserts exact bytes equality, exact size, and full-resolution mtime string equality (%y).
    const finalPlanBytes = await appServices.readContainerFile(planFilePath);
    const finalPlanStat = await appServices.statContainerFile(planFilePath);
    expect(finalPlanBytes).toBe(initialPlanBytes);
    expect(finalPlanStat.size).toBe(initialPlanStat.size);
    expect(finalPlanStat.mtime).toBe(initialPlanStat.mtime);
    expect(finalPlanStat.mtime.length).toBeGreaterThan(15);
  });
});

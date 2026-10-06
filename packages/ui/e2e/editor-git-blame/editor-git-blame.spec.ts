import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import { setupGitBlameFixture } from "./git-fixture.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Editor Git Blame & Commit Reveal Real Application Journey (A01-A11)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test("toggles blame annotations, displays authors, updates on dirty edits, and reveals exact commit details in Workspace Git", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Establish deterministic Git fixture inside running container
    const fixtureMeta = await setupGitBlameFixture(appServices.appContainerId);

    // 2. Navigate to /workspace in authenticated session
    await page.goto(`${appServices.appOrigin}/workspace`);

    // Wait for primary navigation shell and top workspace layout
    const primaryNav = page.locator("nav[aria-label='Primary']").first();
    await expect(primaryNav).toBeVisible({ timeout: 20_000 });

    // Open code.ts from explorer file tree
    const codeFileNode = page.locator("text='code.ts'").first();
    await expect(codeFileNode).toBeVisible({ timeout: 20_000 });
    await codeFileNode.click();

    // Verify Monaco editor mounts code.ts content
    const monacoHost = page.locator(".monaco-host-wrapper").first();
    await expect(monacoHost).toBeVisible({ timeout: 20_000 });

    // 3. Right-click on line numbers to open blame context menu
    // Monaco line numbers container
    const lineNumberTwo = page.locator(".monaco-editor .line-numbers").filter({ hasText: /^2$/ }).first();
    await expect(lineNumberTwo).toBeVisible({ timeout: 15_000 });
    await lineNumberTwo.click({ button: "right" });

    // Context menu should appear with toggle option
    const blameMenu = page.locator("[data-testid='editor-git-blame-menu']");
    await expect(blameMenu).toBeVisible({ timeout: 10_000 });

    const toggleItem = page.locator("[data-testid='editor-git-blame-menu-toggle']");
    await expect(toggleItem).toBeVisible();
    await toggleItem.click();

    // Blame gutter should now be visible and reach ready state
    const blameGutter = page.locator("[data-testid='editor-git-blame-gutter']");
    await expect(blameGutter).toBeVisible({ timeout: 20_000 });

    const rowsContainer = page.locator("[data-testid='editor-git-blame-rows-container']");
    await expect(rowsContainer).toBeVisible({ timeout: 20_000 });

    // Line 2 belongs to Alice Dev
    const row2 = page.locator(".editor-blame-row[data-line='2']");
    await expect(row2).toBeVisible({ timeout: 10_000 });
    await expect(row2).toContainText("Alice Dev");

    // Line 3 belongs to Bob Reviewer
    const row3 = page.locator(".editor-blame-row[data-line='3']");
    await expect(row3).toBeVisible({ timeout: 10_000 });
    await expect(row3).toContainText("Bob Reviewer");

    // Checkpoint 1: Normal author/date blame annotation
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "normal-author-date",
    });

    // 4. Test dirty buffer / unsaved edits
    // Click editor view lines to activate Monaco input and type an unsaved line
    const viewLines = page.locator(".monaco-editor .view-lines").first();
    await viewLines.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("// Unsaved newly typed line for dirty test");

    // Ensure typed content is rendered in editor
    await expect(page.getByText("// Unsaved newly typed line for dirty test").first()).toBeVisible();
    // Verify uncommitted row appears and neighbors remain attributed
    const uncommittedRow = page.locator(".editor-blame-row[data-uncommitted='true']").first();
    await expect(uncommittedRow).toBeVisible({ timeout: 15_000 });
    await expect(uncommittedRow).toContainText("Uncommitted");

    // Line 2 and line 3 still retain Alice Dev and Bob Reviewer
    await expect(row2).toContainText("Alice Dev");
    await expect(row3).toContainText("Bob Reviewer");

    // Checkpoint 2: Uncommitted buffer key state
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "uncommitted-buffer",
    });

    // 5. Open blame context menu on line 3 (committed by Bob)
    await row3.click({ button: "right" });
    await expect(blameMenu).toBeVisible({ timeout: 10_000 });

    const refreshItem = page.locator("[data-testid='editor-git-blame-menu-refresh']");
    await expect(refreshItem).toBeVisible();

    const revealItem = page.locator("[data-testid='editor-git-blame-menu-reveal']");
    await expect(revealItem).toBeVisible();
    await expect(revealItem).not.toHaveAttribute("aria-disabled", "true");

    // Checkpoint 3: Gutter context menu with refresh and reveal options
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "gutter-context-menu",
    });

    // 6. Click "Show Commit in Git" to reveal exact commit in Workspace Git
    await revealItem.click();

    // Verify Workspace Git opens and displays CommitDetailsPanel
    const outsideNotice = page.locator("[data-testid='outside-history-view-notice']");
    await expect(outsideNotice).toBeVisible({ timeout: 20_000 });
    await expect(outsideNotice).toContainText("Commit opened from annotation; outside current history view");

    // Verify multiline commit message subject and body
    const commitSubject = page.getByText(fixtureMeta.bobCommitSubject).first();
    await expect(commitSubject).toBeVisible();

    const commitBodySnippet = page.getByText("This is a multiline commit message body designed for testing full commit inspection").first();
    await expect(commitBodySnippet).toBeVisible();

    // Verify author and changed file listing
    await expect(page.getByText("Bob Reviewer").first()).toBeVisible();
    await expect(page.getByText("code.ts").first()).toBeVisible();

    // Verify original editor tab remains intact and selected
    const editorTab = page.getByRole("tab", { name: /code\.ts/ }).first();
    await expect(editorTab).toBeVisible();
    await expect(editorTab).toHaveAttribute("aria-selected", "true");
    // Checkpoint 4: Workspace Git full commit details with multiline body
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "workspace-git-full-body",
    });

    // 7. Test responsive compact layout (<640px)
    await page.setViewportSize({ width: 620, height: 900 });

    // Confirm gutter switches to compact mode
    await expect(blameGutter).toHaveAttribute("data-blame-mode", "compact", { timeout: 10_000 });

    // Wait for rows container to settle after viewport resize
    await expect(rowsContainer).toBeVisible({ timeout: 15_000 });

    // In compact mode, author-only is shown and row has title with full metadata
    await expect(row3).toBeVisible({ timeout: 10_000 });
    await expect(row3).toContainText("Bob Reviewer");
    const hoverTitle = await row3.getAttribute("title");
    expect(hoverTitle).toBeTruthy();
    expect(hoverTitle).toContain("Bob Reviewer");

    // Checkpoint 5: Compact author-only layout
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "compact-author-only",
    });
  });
});

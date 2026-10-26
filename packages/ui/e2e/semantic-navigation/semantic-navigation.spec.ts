import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/application-fixture.js";
import type { ApplicationServices } from "../fixtures/application-services.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("Phase 10: Linux Server + Actual Web Semantic Qualification", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.use({
    servicesConfig: {
      authBackend: "mongo",
      username: "admin",
      additionalUsernames: ["normaluser"],
      userRoles: {
        normaluser: "user",
      },
      semanticEngine: true,
      seedSemanticFixtures: true,
    },
  });

  async function openSettingsPage(page: Page): Promise<void> {
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/settings`);
  }

  async function openWorkspaceEditor(page: Page): Promise<void> {
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/workspace`);
    await expect(page.locator('[role="treeitem"]:has-text("tsconfig.json")').first()).toBeVisible({ timeout: 25_000 });
  }

  async function openFileInTree(page: Page, fileName: string): Promise<void> {
    const fileItem = page.locator(`[role="treeitem"]:has-text("${fileName}")`).first();
    await expect(fileItem).toBeVisible({ timeout: 15_000 });
    await fileItem.dblclick();
    await page.keyboard.press("Enter");
    const tab = page.locator(`[role="tab"]:has-text("${fileName}")`).first();
    await expect(tab).toBeVisible({ timeout: 10_000 });
    const monacoHost = page.locator(".monaco-host-wrapper").first();
    await expect(monacoHost).toBeVisible({ timeout: 20_000 });
  }

  async function triggerDefinitionAt(page: Page, lineNumber: number, column: number): Promise<void> {
    await page.evaluate(({ line, col }) => {
      const targetWindow = window as unknown as {
        monaco?: {
          editor: {
            getEditors: () => Array<{
              setPosition: (pos: { lineNumber: number; column: number }) => void;
              trigger: (source: string, handlerId: string, payload: unknown) => void;
            }>;
          };
        };
      };
      const editor = targetWindow.monaco?.editor.getEditors()[0];
      if (editor) {
        editor.setPosition({ lineNumber: line, column: col });
        editor.trigger("keyboard", "editor.action.revealDefinition", null);
      }
    }, { line: lineNumber, col: column });
  }

  async function insertTextInMonaco(page: Page, lineNumber: number, column: number, text: string): Promise<void> {
    await page.evaluate(({ line, col, insertText }) => {
      const targetWindow = window as unknown as {
        monaco?: {
          editor: {
            getEditors: () => Array<{
              executeEdits: (source: string, edits: Array<{
                range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
                text: string;
                forceMoveMarkers: boolean;
              }>) => void;
            }>;
          };
        };
      };
      const editor = targetWindow.monaco?.editor.getEditors()[0];
      if (editor) {
        editor.executeEdits("e2e-test", [{
          range: { startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col },
          text: insertText,
          forceMoveMarkers: true,
        }]);
      }
    }, { line: lineNumber, col: column, insertText: text });
  }
  async function deleteLinesInMonaco(page: Page, startLine: number, endLine: number): Promise<void> {
    await page.evaluate(({ start, end }) => {
      const targetWindow = window as unknown as {
        monaco?: {
          editor: {
            getEditors: () => Array<{
              executeEdits: (source: string, edits: Array<{
                range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
                text: string;
                forceMoveMarkers: boolean;
              }>) => void;
            }>;
          };
        };
      };
      const editor = targetWindow.monaco?.editor.getEditors()[0];
      if (editor) {
        editor.executeEdits("e2e-test", [{
          range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 },
          text: "",
          forceMoveMarkers: true,
        }]);
      }
    }, { start: startLine, end: endLine });
  }

  async function findLanguageServerProcesses(appServices: ApplicationServices): Promise<string[]> {
    const output = await appServices.execInContainer([
      "sh",
      "-c",
      'for p in /proc/[0-9]*; do [ "$p" = "/proc/$$" ] && continue; if [ -f "$p/cmdline" ]; then cmd=$(cat "$p/cmdline" 2>/dev/null | tr "\\0" " "); case "$cmd" in *typescript-language-server*|*tsserver*) echo "$p: $cmd" ;; esac; fi; done',
    ]);
    return output.trim() ? output.trim().split("\n") : [];
  }

  async function getMonacoPosition(page: Page): Promise<{ lineNumber: number; column: number }> {
    return await page.evaluate(() => {
      const targetWindow = window as unknown as {
        monaco?: {
          editor: {
            getEditors: () => Array<{
              getPosition: () => { lineNumber: number; column: number };
            }>;
          };
        };
      };
      const editor = targetWindow.monaco?.editor.getEditors()[0];
      return editor ? editor.getPosition() : { lineNumber: 0, column: 0 };
    });
  }

  test("Qualify Linux Server + Actual Web Application Semantic Navigation", async ({
    appServices,
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // =========================================================================
    // 1. Assert default-OFF settings via API & non-admin mutation rejection
    // =========================================================================
    const initialSettingsRes = await appServices.fetchApi("/api/semantic/settings");
    expect(initialSettingsRes.status).toBe(200);
    const initialSettings = await initialSettingsRes.json();
    expect(initialSettings.configuredEnabled).toBe(false);
    expect(initialSettings.runtimeEnabled).toBe(false);
    expect(initialSettings.policyCapability).toBe("portable-only");
    expect(initialSettings.canMutate).toBe(true);

    // Corroborate zero child processes in container
    const initialProcs = await findLanguageServerProcesses(appServices);
    expect(initialProcs.length).toBe(0);

    // Assert ordinary user mutation is rejected with 403 Forbidden
    const normalUserSession = appServices.additionalSessions.find((s) => s.username === "normaluser");
    expect(normalUserSession).toBeDefined();
    const userRejectRes = await fetch(`${new URL(page.url()).origin}/api/semantic/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalUserSession?.token}`,
      },
      body: JSON.stringify({ enabled: true }),
    });
    expect(userRejectRes.status).toBe(403);

    // Navigate to Settings page to capture Checkpoint 1
    await openSettingsPage(page);
    const semanticAccordion = page.locator('button:has-text("Semantic Navigation")').first();
    await expect(semanticAccordion).toBeVisible({ timeout: 15_000 });
    const toggleSwitch = page.locator('button[role="switch"][aria-label="Enable semantic navigation"]').first();
    if (!await toggleSwitch.isVisible().catch(() => false)) {
      await semanticAccordion.click();
    }
    await expect(toggleSwitch).toBeVisible({ timeout: 10_000 });
    await toggleSwitch.scrollIntoViewIfNeeded();
    const isInitiallyChecked = (await toggleSwitch.getAttribute("aria-checked")) === "true";
    expect(isInitiallyChecked).toBe(false);
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "default-off",
    });
    // =========================================================================
    // 2. Admin UI hot toggle enable & verify portable limits banner
    // =========================================================================
    await toggleSwitch.click();
    await expect(toggleSwitch).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
    await toggleSwitch.scrollIntoViewIfNeeded();
    const enabledSettingsRes = await appServices.fetchApi("/api/semantic/settings");
    const enabledSettings = await enabledSettingsRes.json();
    expect(enabledSettings.configuredEnabled).toBe(true);
    expect(enabledSettings.runtimeEnabled).toBe(true);

    // Corroborate zero child processes on initial idle
    const postEnableProcs = await findLanguageServerProcesses(appServices);
    expect(postEnableProcs.length).toBe(0);

    // Capture Checkpoint 2: admin-enabled-portable
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "admin-enabled-portable",
    });
    // =========================================================================
    // 3. Monaco Navigation across 4 extensions, non-BMP UTF-16, and multi-result
    // =========================================================================
    await openWorkspaceEditor(page);

    // 3.1 TS: impl.ts -> definition jump to types.ts
    await openFileInTree(page, "impl.ts");
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 30_000 });

    // Verify child language server process is actively running in container
    const activeProcs = await findLanguageServerProcesses(appServices);
    expect(activeProcs.length).toBeGreaterThan(0);

    // Trigger Go to Definition on SemanticItem at line 3, column 42
    await triggerDefinitionAt(page, 3, 48);
    const typesTab = page.locator('[role="tab"]:has-text("types.ts")').first();
    await expect(typesTab).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(1);

    // Capture Checkpoint 3: definition-jump
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "definition-jump",
    });
    // 3.2 TSX: widget.tsx -> definition jump to impl.ts
    await openFileInTree(page, "widget.tsx");
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    await triggerDefinitionAt(page, 5, 25);
    const implTab = page.locator('[role="tab"]:has-text("impl.ts")').first();
    await expect(implTab).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => [3, 4, 5].includes((await getMonacoPosition(page)).lineNumber), { timeout: 15_000 }).toBe(true);

    // 3.3 JSX: card.jsx -> definition jump to helper.js
    await openFileInTree(page, "card.jsx");
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    await triggerDefinitionAt(page, 5, 25);
    const helperTab = page.locator('[role="tab"]:has-text("helper.js")').first();
    await expect(helperTab).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(1);

    // 3.4 Non-BMP UTF-16: unicode.ts
    // Line 4: export const PREFIXED_BANNER = "Prefix 🌍🚀 " + BANNER;
    await openFileInTree(page, "unicode.ts");
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    await triggerDefinitionAt(page, 4, 50);
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(2);

    // 3.5 Multi-result selection: multi_def.ts
    // Line 9: export const activeConfig: MultiTargetConfig = {
    await openFileInTree(page, "multi_def.ts");
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    await triggerDefinitionAt(page, 9, 30);
    const peekWidget = page.locator(".monaco-editor .peekview-widget, .monaco-editor .zone-widget").first();
    await expect(peekWidget).toBeVisible({ timeout: 15_000 });
    await expect(peekWidget).toContainText("MultiTargetConfig");

    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "multi-result-selection",
    });
    await page.keyboard.press("Escape");

    // 3.6 Unsupported language: unsupported.rs
    await openFileInTree(page, "unsupported.rs");
    const unsupportedLines = page.locator(".monaco-editor .view-lines").first();
    await expect(unsupportedLines).toContainText("unsupported_semantic");
    await expect(page.locator('text="TS/JS Ready"')).toHaveCount(0);

    // =========================================================================
    // 4. Dirty buffer freshness & Adaptive sync threshold crossings
    // =========================================================================
    // 4.1 In-memory dirty edit in impl.ts and reference in widget.tsx
    await openFileInTree(page, "impl.ts");
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    // Insert getUnsavedValue and testDirtyCall inside StandardSemanticItem before closing brace
    await insertTextInMonaco(
      page,
      12,
      4,
      "\n  getUnsavedValue(): number {\n    return 999;\n  }\n\n  testDirtyCall(): number {\n    return this.getUnsavedValue();\n  }",
    );
    await expect(page.locator('[role="tab"]:has-text("impl.ts")[data-dirty="true"]')).toBeVisible({ timeout: 5_000 });

    // Navigate to in-memory dirty method from testDirtyCall (line 18, col 20)
    await triggerDefinitionAt(page, 18, 20);
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(13);
    // Verify disk content on container remains untouched (no getUnsavedValue on disk)
    const diskContent = await appServices.readContainerFile("e2e/workspace/fixture-project/impl.ts");
    expect(diskContent).not.toContain("getUnsavedValue");
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "threshold-dirty-edit",
    });
    // 4.2 Adaptive sync threshold crossings in adaptive_sync.ts (~61.7 KiB base)
    await openFileInTree(page, "adaptive_sync.ts");
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    // Below threshold jump: line 767, column 12 -> jumps to line 1
    await triggerDefinitionAt(page, 767, 12);
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(1);

    // Cross above threshold: insert 100 comment lines (~8 KiB) to push size > 69 KiB
    await insertTextInMonaco(page, 4, 1, "// Padding comment crossing above 64 KiB threshold\n".repeat(100));
    // Above threshold jump: line 867, column 12 -> jumps to line 1
    await triggerDefinitionAt(page, 867, 12);
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(1);

    // Cross back below threshold: undo the inserted comment lines
    await deleteLinesInMonaco(page, 4, 104);
    await triggerDefinitionAt(page, 767, 12);
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(1);

    // 4.3 Reconnect recovery: force socket loss and verify dirty buffer continuity
    const implTabForReconnect = page.locator('[role="tab"]:has-text("impl.ts")').first();
    await implTabForReconnect.click();
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      const targetWindow = window as unknown as {
        __dam_hopper_semantic_store?: {
          getState: () => {
            findClientForTab: (tabKey: string) => {
              forceSocketLoss: () => void;
            } | null;
          };
        };
        __dam_hopper_editor_store?: {
          getState: () => {
            tabs: Array<{ key: string; name: string }>;
          };
        };
      };
      const implTab = targetWindow.__dam_hopper_editor_store
        ?.getState()
        .tabs.find((t) => t.name === "impl.ts");
      if (!implTab) throw new Error("No impl.ts tab found in editor store");
      const client = targetWindow.__dam_hopper_semantic_store
        ?.getState()
        .findClientForTab(implTab.key);
      if (!client) throw new Error("No client found for impl.ts tab");
      client.forceSocketLoss();
    });

    // Wait for auto-reconnect to restore ready state
    await expect(page.locator('text="TS/JS Ready"').first()).toBeVisible({ timeout: 20_000 });
    const reconnectedLines = page.locator(".monaco-editor .view-lines").first();
    await expect(reconnectedLines).toContainText("getUnsavedValue");

    // Allow language server to finish parsing replayed models
    await page.waitForTimeout(1000);

    // Verify post-reconnect navigation works on restored session
    await triggerDefinitionAt(page, 3, 48);
    const reconnectedTypesTab = page.locator('[role="tab"]:has-text("types.ts")').first();
    await expect(reconnectedTypesTab).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await getMonacoPosition(page)).lineNumber, { timeout: 15_000 }).toBe(1);
    // =========================================================================
    // 5. Admin disable teardown, zero children, and narrow dock layout
    // =========================================================================
    await openSettingsPage(page);
    const settingsAccordion = page.locator('button:has-text("Semantic Navigation")').first();
    await expect(settingsAccordion).toBeVisible({ timeout: 15_000 });
    const toggleDisable = page.locator('button[role="switch"][aria-label="Enable semantic navigation"]').first();
    if (!await toggleDisable.isVisible().catch(() => false)) {
      await settingsAccordion.click();
    }
    await expect(toggleDisable).toBeVisible({ timeout: 10_000 });
    await toggleDisable.click();
    await expect(toggleDisable).toHaveAttribute("aria-checked", "false", { timeout: 10_000 });

    const disabledMsg = page.getByText("Semantic navigation disabled").first();
    await expect(disabledMsg).toBeVisible({ timeout: 15_000 });

    // Verify strictly zero child processes remain in container
    await page.waitForTimeout(2000);
    const postTeardownProcs = await findLanguageServerProcesses(appServices);
    expect(postTeardownProcs.length).toBe(0);

    // Return to workspace editor and verify dock layout
    await openWorkspaceEditor(page);
    await openFileInTree(page, "impl.ts");
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "narrow-layout-dock",
      dockWidth: 320,
    });
  });
});

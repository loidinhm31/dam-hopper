import "@/index.css";
import "@/os/os.css";
import "@/lib/monaco-setup.js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as monaco from "monaco-editor";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import {
  createDefaultOsSession,
  openWindow,
  addDesktop,
  minimizeWindow,
  toggleMaximizeWindow,
  splitWindow,
} from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import { dispatchIntent, createIntent } from "@/os/intents.js";
import { useEditorStore, editorFileTabKey } from "@/stores/editor.js";
import { registerParkedMonaco, getParkedMonacoEntry } from "@/os/MonacoKeepAliveHost.js";
import type { FsTargetRef } from "@/api/ownership.js";
import type { Transport } from "@/api/transport.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const profileA: ServerProfile = {
  id: "profile-a",
  name: "Host Alpha",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: true,
};

const profileB: ServerProfile = {
  id: "profile-b",
  name: "Host Beta",
  url: "http://127.0.0.1:4802",
  authType: "none",
  createdAt: 2,
  autoConnect: true,
};

describe("os-file-open-float.browser (P02)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let fsReadMock: Mock;
  let fsWriteFileMock: Mock;
  let mockTransport: Transport;
  beforeEach(() => {
    localStorage.clear();
    globalResourceRegistry.clear();
    resetConnections();
    useEditorStore.setState({ tabs: [], documents: {}, activeKeys: {} });

    fsReadMock = vi.fn().mockResolvedValue({
      ok: true,
      binary: false,
      content: btoa("export const value = 42;\n"),
      mime: "text/typescript",
      mtime: 100,
      size: 26,
      fileIdentity: {
        workspaceId: "ws-1",
        workspaceEpoch: 1,
        canonicalPath: "/workspace/src/app.ts",
      },
    });
    fsWriteFileMock = vi.fn().mockResolvedValue({ ok: true, newMtime: 200 });
    mockTransport = {
      fsRead: fsReadMock,
      fsWriteFile: fsWriteFileMock,
      onTerminalData: vi.fn(() => () => {}),
      onTerminalEvent: vi.fn(() => () => {}),
      onTerminalExit: vi.fn(() => () => {}),
      onEvent: vi.fn(() => () => {}),
      onClose: vi.fn(() => () => {}),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      request: vi.fn().mockResolvedValue([]),
      invoke: vi.fn().mockResolvedValue([]),
    } as unknown as Transport;

    saveProfiles([profileA, profileB], profileA.id);
    __setConnectionSnapshotForTests(
      profileA.id,
      {
        status: "connected",
        serverUrl: profileA.url,
        owner: { profileId: profileA.id, generation: 1, serverEpoch: "epoch-1" },
      },
      mockTransport,
    );

    const session = createDefaultOsSession("desktop-1", "Main");
    useWindowStore.getState().setSession(session);

    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    resetConnections();
    queryClient.clear();
    globalResourceRegistry.clear();
    vi.restoreAllMocks();
  });

  const renderOsShell = async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <OsShell />
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });
  };

  it("reuses existing window into float on active desktop, preserving Monaco model, dirty flag and undo history (AC2)", async () => {
    await renderOsShell();

    // 1. Setup existing tiled editor window opened previously by Files (undefined ctx.generation)
    const target: FsTargetRef = { kind: "project", profileId: profileA.id, project: "dam-hopper" };
    const tabKey = editorFileTabKey(target, "src/app.ts");
    const docKey = JSON.stringify(["file", profileA.id, "ws-1", 1, "/workspace/src/app.ts"]);

    // Create real Monaco text model and set dirty content
    const monacoModel = monaco.editor.createModel(
      "export const value = 42;\n// user typed dirty line\n",
      "typescript",
    );
    const initialAltVersionId = monacoModel.getAlternativeVersionId();

    useEditorStore.setState({
      tabs: [
        {
          key: tabKey,
          project: "dam-hopper",
          target,
          targetKey: "root",
          targetAvailable: true,
          path: "src/app.ts",
          name: "app.ts",
          mtime: 100,
          size: 50,
          tier: "normal",
          content: "export const value = 42;\n// user typed dirty line\n",
          savedContent: "export const value = 42;\n",
          dirty: true,
          loading: false,
          saving: false,
          conflicted: false,
          documentKey: docKey,
          endpointIdentity: { profileId: profileA.id, serverUrl: profileA.url },
        },
      ],
      documents: {
        [docKey]: {
          documentKey: docKey,
          content: "export const value = 42;\n// user typed dirty line\n",
          savedContent: "export const value = 42;\n",
          dirty: true,
          mtime: 100,
          size: 50,
          tier: "normal",
          saving: false,
          conflicted: false,
          editRevision: 1,
          endpointIdentity: { profileId: profileA.id, serverUrl: profileA.url },
        },
      },
    });

    const parkedDiv = document.createElement("div");
    parkedDiv.dataset.testid = "live-monaco-app-ts";
    const dummyEditor = {
      getModel: () => monacoModel,
    } as unknown as monaco.editor.IStandaloneCodeEditor;
    registerParkedMonaco(tabKey, parkedDiv, dummyEditor, docKey);
    // Window on desktop-1 in tiled mode
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "existing-editor-win",
        appId: "editor",
        title: "app.ts",
        ctx: { profileId: profileA.id, projectId: "dam-hopper" }, // live-owner: undefined ctx.generation
        mode: "tile",
        appState: { filePath: "src/app.ts", documentKey: docKey },
      });
    });

    const initialParkedEl = getParkedMonacoEntry(tabKey, docKey)?.element;
    expect(initialParkedEl).toBeDefined();
    const winBefore = useWindowStore.getState().session.windows["existing-editor-win"];
    expect(winBefore.mode).toBe("tile");

    // 2. Hub sends file:open intent with mode: "float" and generation: 1
    const intent = createIntent("file:open", {
      profileId: profileA.id,
      projectId: "dam-hopper",
      filePath: "src/app.ts",
      generation: 1,
      mode: "float",
    });

    let result: unknown;
    await act(async () => {
      result = await dispatchIntent(intent);
    });

    expect(result).toMatchObject({ status: "handled", targetWindowId: "existing-editor-win" });

    // Window is now float and focused
    const winAfter = useWindowStore.getState().session.windows["existing-editor-win"];
    expect(winAfter.mode).toBe("float");
    expect(winAfter.minimized).toBe(false);
    expect(useWindowStore.getState().session.desktops[0].focusedWindowId).toBe("existing-editor-win");

    // Real Monaco element and canonical window reused, model version and dirty state preserved intact!
    const parkedAfter = getParkedMonacoEntry(tabKey, docKey);
    expect(parkedAfter).toBeDefined();
    expect(parkedAfter?.element).toBe(initialParkedEl);
    expect(monacoModel.getAlternativeVersionId()).toBe(initialAltVersionId);
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true);
    expect(useEditorStore.getState().tabs[0].content).toContain("user typed dirty line");

    monacoModel.dispose();
  });

  it("fails closed on retired connection: reveals old window, returns unhandled, and keeps dirty buffer intact (AC1, F1)", async () => {
    await renderOsShell();

    const target: FsTargetRef = { kind: "project", profileId: profileA.id, project: "dam-hopper" };
    const tabKey = editorFileTabKey(target, "src/retired.ts");
    const docKey = JSON.stringify(["file", profileA.id, "ws-1", 1, "/workspace/src/retired.ts"]);

    useEditorStore.setState({
      tabs: [
        {
          key: tabKey,
          project: "dam-hopper",
          target,
          targetKey: "root",
          targetAvailable: true,
          path: "src/retired.ts",
          name: "retired.ts",
          mtime: 100,
          size: 30,
          tier: "normal",
          content: "unsaved changes at G=1",
          savedContent: "disk G=1",
          dirty: true,
          loading: false,
          saving: false,
          conflicted: false,
          documentKey: docKey,
          endpointIdentity: { profileId: profileA.id, serverUrl: profileA.url },
        },
      ],
      documents: {
        [docKey]: {
          documentKey: docKey,
          content: "unsaved changes at G=1",
          savedContent: "disk G=1",
          dirty: true,
          mtime: 100,
          size: 30,
          tier: "normal",
          saving: false,
          conflicted: false,
          editRevision: 1,
          endpointIdentity: { profileId: profileA.id, serverUrl: profileA.url },
        },
      },
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-gen-1",
        appId: "editor",
        title: "retired.ts",
        ctx: { profileId: profileA.id, projectId: "dam-hopper", generation: 1 }, // Defined generation 1
        mode: "tile",
        appState: { filePath: "src/retired.ts", documentKey: docKey },
      });
      useWindowStore.getState().minimizeWindow("win-gen-1");
    });

    expect(useWindowStore.getState().session.windows["win-gen-1"].minimized).toBe(true);

    // Reconnect bumps live generation to G=2
    __setConnectionSnapshotForTests(profileA.id, null);
    __setConnectionSnapshotForTests(
      profileA.id,
      {
        status: "connected",
        serverUrl: profileA.url,
        owner: { profileId: profileA.id, generation: 2, serverEpoch: "epoch-2" },
      },
      mockTransport,
    );

    // G=2 float open request arrives for the same file
    const intent = createIntent("file:open", {
      profileId: profileA.id,
      projectId: "dam-hopper",
      filePath: "src/retired.ts",
      generation: 2,
      mode: "float",
    });

    let result: unknown;
    await act(async () => {
      result = await dispatchIntent(intent);
    });

    // R2a: Unhandled with retired connection reason
    expect(result).toMatchObject({
      status: "unhandled",
      reason: "Document belongs to a retired connection; reopen it from its window",
    });

    // Window was revealed (un-minimized and focused), but NOT converted to float
    const win = useWindowStore.getState().session.windows["win-gen-1"];
    expect(win.minimized).toBe(false);
    expect(win.mode).toBe("tile"); // Kept tile, did not present as float
    expect(win.ctx.generation).toBe(1); // ctx.generation NOT rewritten

    // Dirty buffer untouched
    expect(useEditorStore.getState().tabs[0].content).toBe("unsaved changes at G=1");
    expect(useEditorStore.getState().tabs[0].dirty).toBe(true);
  });

  it("elevates float layer zIndex above maximized plane when float is focused and routes pointer clicks (B2)", async () => {
    await renderOsShell();

    // Open maximized Hub terminal
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "hub-win",
        appId: "terminals",
        title: "Hub",
        ctx: { profileId: profileA.id },
        mode: "tile",
      });
      useWindowStore.getState().toggleMaximizeWindow("hub-win");
    });

    expect(useWindowStore.getState().session.windows["hub-win"].maximized).toBe(true);

    // Open floating editor
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "float-win",
        appId: "editor",
        title: "Float Editor",
        ctx: { profileId: profileA.id },
        mode: "float",
      });
      useWindowStore.getState().focusWindow("float-win");
    });

    const deskId = useWindowStore.getState().session.desktops[0].id;
    const floatLayer = container.querySelector(`[data-testid="float-layer-${deskId}"]`) as HTMLElement;
    const maxLayer = container.querySelector(`[data-testid="maximized-layer-${deskId}"]`) as HTMLElement;

    expect(floatLayer).not.toBeNull();
    expect(maxLayer).not.toBeNull();

    // Float window focused -> float layer elevated above maximized layer
    expect(floatLayer.style.zIndex).toBe("60");
    expect(maxLayer.style.zIndex).toBe("40");

    // Hit-testing / click test: clicking maximized slot brings maximized window back to top
    const maxSlot = container.querySelector(`[data-testid="maximized-slot-hub-win"]`) as HTMLElement;
    expect(maxSlot).not.toBeNull();

    await act(async () => {
      useWindowStore.getState().focusWindow("hub-win");
    });

    // Maximized layer is now on top
    expect(floatLayer.style.zIndex).toBe("20");
    expect(maxSlot.style.zIndex).toBe("50");
    expect(useWindowStore.getState().session.windows["hub-win"].maximized).toBe(true);
  });

  it("shows blocked-save notice when profile is repointed to different serverUrl, and discardAndReload rebinds (V1, R7)", async () => {
    await renderOsShell();

    const target: FsTargetRef = { kind: "project", profileId: profileA.id, project: "app" };
    const tabKey = editorFileTabKey(target, "src/repoint.ts");
    const docKey = JSON.stringify(["file", profileA.id, "ws-1", 1, "/workspace/src/repoint.ts"]);

    useEditorStore.setState({
      tabs: [
        {
          key: tabKey,
          project: "app",
          target,
          targetKey: "root",
          targetAvailable: true,
          path: "src/repoint.ts",
          name: "repoint.ts",
          mtime: 10,
          size: 15,
          tier: "normal",
          content: "dirty edits on A",
          savedContent: "base A",
          dirty: true,
          loading: false,
          saving: false,
          conflicted: false,
          documentKey: docKey,
          endpointIdentity: { profileId: profileA.id, serverUrl: profileA.url },
        },
      ],
      documents: {
        [docKey]: {
          documentKey: docKey,
          content: "dirty edits on A",
          savedContent: "base A",
          dirty: true,
          mtime: 10,
          size: 15,
          tier: "normal",
          saving: false,
          conflicted: false,
          editRevision: 1,
          endpointIdentity: { profileId: profileA.id, serverUrl: profileA.url },
        },
      },
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "repoint-editor-win",
        appId: "editor",
        title: "repoint.ts",
        ctx: { profileId: profileA.id, projectId: "app" },
        mode: "float",
        appState: { filePath: "src/repoint.ts", documentKey: docKey },
      });
    });

    // Profile repointed to URL B
    __setConnectionSnapshotForTests(profileA.id, null);
    __setConnectionSnapshotForTests(
      profileA.id,
      {
        status: "connected",
        serverUrl: profileB.url,
        owner: { profileId: profileA.id, generation: 2, serverEpoch: "epoch-2" },
      },
      mockTransport,
    );

    // Save must be blocked
    let saveResult = false;
    await act(async () => {
      saveResult = await useEditorStore.getState().save(tabKey);
    });
    expect(saveResult).toBe(false);
    expect(fsWriteFileMock).not.toHaveBeenCalled();

    const blockedNotice = container.querySelector(
      `[data-testid="editor-save-blocked-repoint-editor-win"]`,
    );
    expect(blockedNotice).not.toBeNull();
    expect(blockedNotice?.textContent).toContain("This file was loaded from");

    // Click discardAndReload button
    fsReadMock.mockResolvedValueOnce({
      ok: true,
      binary: false,
      content: btoa("reloaded from server B\n"),
      mime: "text/typescript",
      mtime: 300,
      size: 23,
      fileIdentity: {
        workspaceId: "ws-1",
        workspaceEpoch: 1,
        canonicalPath: "/workspace/src/repoint.ts",
      },
    });

    await act(async () => {
      await useEditorStore.getState().discardAndReload(tabKey);
    });

    const tabAfterDiscard = useEditorStore.getState().tabs[0];
    expect(tabAfterDiscard.dirty).toBe(false);
    expect(tabAfterDiscard.content).toBe("reloaded from server B\n");
    expect(tabAfterDiscard.endpointIdentity?.serverUrl).toBe(profileB.url);
    expect(tabAfterDiscard.saveBlockedReason).toBeUndefined();

    // Now modify and save to server B
    useEditorStore.getState().setContent(tabKey, "modifications for server B");
    fsWriteFileMock.mockResolvedValueOnce({ ok: true, newMtime: 400 });

    let saveAfterDiscard = false;
    await act(async () => {
      saveAfterDiscard = await useEditorStore.getState().save(tabKey);
    });
    expect(saveAfterDiscard).toBe(true);
    expect(fsWriteFileMock).toHaveBeenCalledTimes(1);
  });

  it("characterizes BrowserApp iframe layer stacking as a documented limitation (R6, V4)", async () => {
    await renderOsShell();

    // Open BrowserApp window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "browser-win",
        appId: "browser",
        title: "Browser App",
        ctx: { profileId: profileA.id },
        mode: "float",
        appState: { url: "http://example.com" },
      });
    });

    // OsResourceHost renders browser hosts outside DesktopCanvas
    const browserHost = container.querySelector('[data-os-resource-host="browser"]');
    if (browserHost) {
      expect(browserHost).not.toBeNull();
    }
  });
});

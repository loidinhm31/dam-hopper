// @vitest-environment jsdom
import { vi } from "vitest";
vi.hoisted(() => {
  Object.assign(document, { queryCommandSupported: () => false });
  Object.assign(window, { CSS: { escape: (s: string) => s }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
vi.mock("@/lib/monaco-setup.js", () => ({}));
import { act } from "react";
const hashContent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/semantic-model-uri.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/semantic-model-uri.js")>("@/lib/semantic-model-uri.js");
  hashContent.mockImplementation(actual.computeUtf8Sha256Hex);
  return { ...actual, computeUtf8Sha256Hex: hashContent };
});
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MonacoHost } from "./MonacoHost.js";
import { buildLocalModelUri, defaultSemanticModelRegistry, computeUtf8Sha256Hex } from "@/lib/semantic-model-uri.js";
import { useSemanticNavigationStore, type NavigationRevealIntent } from "@/stores/semantic-navigation.js";
import { editorFileTabKey, type Tab } from "@/stores/editor.js";
import type { SemanticClient } from "@/api/semantic-client.js";

let editorProps: Record<string, unknown>;
vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({ isAndroidChromeNativeInputSuppressed: false }),
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: Object.assign(() => ({}), {
    getState: () => ({ editorFontSize: 13, editorZoomWheelEnabled: true }), subscribe: () => () => {},
  }), clampFont: (value: number) => value,
}));
vi.mock("@/hooks/use-shortcuts.js", () => ({ addKeyboardShortcutListener: () => () => {}, addWheelShortcutListener: () => () => {} }));
vi.mock("@/hooks/use-editor-git-blame.js", () => ({ useEditorGitBlame: () => ({ data: null, status: "idle" }) }));
vi.mock("@monaco-editor/react", () => ({ default: (props: Record<string, unknown>) => {
  editorProps = props; return <div data-testid="monaco-editor" />;
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = { project: "project-a", profileId: "profile-a", worktreePath: "/worktrees/feature" };
const provenance = { serverUrl: "http://localhost:4803", configuredRoot: "/projects/project-a", actor: "actor-a" };
const text = "const value = 1;\nvalue;\n";
function makeTab(path = "src/main.ts"): Tab {
  return { key: editorFileTabKey(target, path), project: target.project, target, targetKey: "worktree:/worktrees/feature",
    targetAvailable: true, name: path, path, tier: "normal", mtime: 1, size: text.length, content: text,
    savedContent: text, dirty: false, loading: false, saving: false, conflicted: false, semanticProvenance: provenance };
}

describe("MonacoHost authority and reveal coordination", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: Partial<SemanticClient>;
  beforeEach(() => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    defaultSemanticModelRegistry.clearAll();
    useSemanticNavigationStore.getState().disconnectAll();
    useSemanticNavigationStore.setState({ globalSemanticEnabled: true, profileSemanticEnabled: {}, activeRevealIntent: null });
    client = { getStatus: () => "ready", getTargetId: () => "target-a", canAccessModel: vi.fn().mockReturnValue(true),
      notifyDidOpen: vi.fn().mockResolvedValue(undefined), notifyDidChange: vi.fn().mockResolvedValue(2), notifyDidClose: vi.fn() };
    vi.spyOn(useSemanticNavigationStore.getState(), "findClientForTab").mockImplementation(() => client as SemanticClient);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); defaultSemanticModelRegistry.clearAll(); });

  function render(tab: Tab) {
    act(() => root.render(<MonacoHost tabKey={tab.key} path={tab.path} content={tab.content} tier="normal" tab={tab}
      onChange={() => {}} onSave={() => {}} onViewStateChange={() => {}} />));
  }
  function mount(tab: Tab) {
    const model = { uri: { toString: () => buildLocalModelUri(tab.key) }, getVersionId: vi.fn().mockReturnValue(1),
      getValue: vi.fn().mockReturnValue(tab.content), isDisposed: () => false };
    const editor = { getModel: () => model, restoreViewState: vi.fn(), saveViewState: vi.fn(), deltaDecorations: vi.fn(() => []),
      updateOptions: vi.fn(), addCommand: vi.fn(), addAction: vi.fn(), onMouseDown: vi.fn(), onContextMenu: vi.fn(),
      onKeyDown: vi.fn(), onDidBlurEditorWidget: vi.fn(), onDidChangeCursorPosition: vi.fn(), onDidScrollChange: vi.fn(),
      revealRangeInCenter: vi.fn(), setSelection: vi.fn(), focus: vi.fn(), getDomNode: () => container, layout: vi.fn() };
    const monaco = { Uri: { parse: (value: string) => ({ toString: () => value }) }, KeyMod: { CtrlCmd: 2048 },
      KeyCode: { KeyS: 49 }, editor: { MouseTargetType: {} } };
    act(() => (editorProps.onMount as (editor: unknown, monaco: unknown) => void)(editor, monaco));
    return { editor, model };
  }
  async function intent(tab: Tab): Promise<NavigationRevealIntent> {
    return { targetId: "target-a", profileId: target.profileId, project: tab.project, targetKey: tab.targetKey,
      relativePath: tab.path, range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 6 },
      destinationContentSha256: await computeUtf8Sha256Hex(tab.content), destinationVersion: null,
      createdAt: Date.now(), isCurrent: () => true };
  }

  it("captures the tab's original accepted provenance even when first mounted with semantics OFF", () => {
    const tab = makeTab();
    useSemanticNavigationStore.setState({ globalSemanticEnabled: false });
    render(tab);
    expect(defaultSemanticModelRegistry.getByTabKey(tab.key)?.identity.provenance).toEqual(provenance);
    expect(client.notifyDidOpen).not.toHaveBeenCalled();
    expect(editorProps.keepCurrentModel).toBe(true);
  });
  it("does not synthesize missing provenance from a later render or reconnect", () => {
    const tab = { ...makeTab(), semanticProvenance: null };
    render(tab);
    expect(defaultSemanticModelRegistry.getByTabKey(tab.key)).toBeUndefined();
    expect(client.notifyDidOpen).not.toHaveBeenCalled();
  });
  it("keeps a foreign-binding draft local and consults the replacement client before each edit", () => {
    const tab = makeTab(); render(tab);
    const change = editorProps.onChange as (value: string, event: { changes: unknown[] }) => void;
    act(() => change("local edit one", { changes: [] }));
    expect(client.notifyDidChange).toHaveBeenCalledWith(tab.key, "local edit one", undefined);
    const replacement = { ...client, canAccessModel: vi.fn().mockReturnValue(false), notifyDidChange: vi.fn(), notifyDidOpen: vi.fn() };
    client = replacement;
    act(() => change("local edit two", { changes: [] }));
    expect(replacement.notifyDidChange).not.toHaveBeenCalled();
    expect(defaultSemanticModelRegistry.getByTabKey(tab.key)?.identity.provenance).toEqual(provenance);
  });
  it("reveals only the exact proven destination content", async () => {
    const tab = makeTab(); render(tab); const { editor } = mount(tab);
    const reveal = await intent(tab);
    await act(async () => { useSemanticNavigationStore.getState().setRevealIntent(reveal); });
    expect(editor.revealRangeInCenter).toHaveBeenCalledWith(reveal.range);
    expect(editor.setSelection).toHaveBeenCalledWith(reveal.range);
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBeNull();
  });
  it("mount never bypasses association validation for a preexisting reveal intent", async () => {
    const tab = makeTab();
    const reveal = { ...await intent(tab), destinationContentSha256: "0".repeat(64) };
    useSemanticNavigationStore.getState().setRevealIntent(reveal);
    render(tab);
    const { editor } = mount(tab);
    await act(async () => {});
    expect(editor.revealRangeInCenter).not.toHaveBeenCalled();
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBe(reveal);
  });

  it("identical text after close/reopen does not inherit an in-flight reveal", async () => {
    const tab = makeTab(); render(tab); const { editor } = mount(tab);
    const reveal = await intent(tab);
    const proof = Promise.withResolvers<string>();
    hashContent.mockReturnValueOnce(proof.promise);
    act(() => useSemanticNavigationStore.getState().setRevealIntent(reveal));
    defaultSemanticModelRegistry.unregisterModel(tab.key);
    defaultSemanticModelRegistry.registerModel({ tabKey: tab.key, profileId: target.profileId, project: target.project,
      targetKey: tab.targetKey, relativePath: tab.path, provenance });
    await act(async () => { proof.resolve(reveal.destinationContentSha256!); });
    expect(editor.setSelection).not.toHaveBeenCalled();
  });

  it("rejects changed content and stale authority instead of blindly consuming a reveal", async () => {
    const tab = makeTab(); render(tab); const { editor, model } = mount(tab);
    const reveal = await intent(tab);
    model.getValue.mockReturnValue("different destination text");
    await act(async () => { useSemanticNavigationStore.getState().setRevealIntent(reveal); });
    expect(editor.revealRangeInCenter).not.toHaveBeenCalled();
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBe(reveal);
    model.getValue.mockReturnValue(tab.content);
    await act(async () => { useSemanticNavigationStore.getState().setRevealIntent({ ...reveal, isCurrent: () => false }); });
    expect(editor.setSelection).not.toHaveBeenCalled();
  });
  it("an older async hash completion cannot consume a newer reveal intent", async () => {
    const tab = makeTab(); render(tab); const { editor } = mount(tab);
    const old = await intent(tab);
    const newer = { ...old, range: { ...old.range, startColumn: 2 } };
    const oldHash = Promise.withResolvers<string>();
    const newHash = Promise.withResolvers<string>();
    hashContent.mockReturnValueOnce(oldHash.promise);
    hashContent.mockReturnValueOnce(newHash.promise);
    act(() => useSemanticNavigationStore.getState().setRevealIntent(old));
    act(() => useSemanticNavigationStore.getState().setRevealIntent(newer));
    await act(async () => { oldHash.resolve(old.destinationContentSha256!); });
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBe(newer);
    expect(editor.setSelection).not.toHaveBeenCalled();
    await act(async () => { newHash.resolve(newer.destinationContentSha256!); });
    expect(editor.setSelection).toHaveBeenCalledTimes(1);
    expect(editor.setSelection).toHaveBeenCalledWith(newer.range);
  });
  it("unsupported files never acquire a semantic model or forward edits", () => {
    const tab = makeTab("README.md"); render(tab);
    act(() => (editorProps.onChange as (text: string, event: { changes: unknown[] }) => void)("# local", { changes: [] }));
    expect(defaultSemanticModelRegistry.getByTabKey(tab.key)).toBeUndefined();
    expect(client.notifyDidChange).not.toHaveBeenCalled();
  });
});

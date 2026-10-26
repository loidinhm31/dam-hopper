// @vitest-environment jsdom
import { vi } from "vitest";
vi.hoisted(() => {
  Object.assign(document, { queryCommandSupported: () => false });
  Object.assign(window, { CSS: { escape: (s: string) => s }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
import "@/lib/monaco-setup.js";
import { describe, it, expect, afterEach } from "vitest";
import * as monaco from "monaco-editor";
import { monacoPositionToLsp, lspRangeToMonaco, SemanticMonacoManager, resolveSemanticDestination } from "./semantic-monaco.js";
import { SemanticModelRegistry } from "./semantic-model-uri.js";
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import type { SemanticClient } from "@/api/semantic-client.js";
import { useSemanticNavigationStore } from "@/stores/semantic-navigation.js";

function fixture(worktreePath: string | null = "/worktrees/feature") {
  const target = { profileId: "profile-a", project: "project-a", worktreePath };
  const tabKey = editorFileTabKey(target, "src/main.ts");
  const registry = new SemanticModelRegistry();
  const registered = registry.registerModel({ tabKey, profileId: target.profileId, project: target.project,
    targetKey: worktreePath ? `worktree:${worktreePath}` : "root", relativePath: "src/main.ts" });
  const tab = { key: tabKey, target, project: target.project, targetKey: registered.identity.targetKey,
    targetAvailable: true, path: "src/main.ts", content: "const x = 1;" } as Tab;
  registry.bindWire(tabKey, { targetId: "session-target", connectionGeneration: 1, targetGeneration: 1,
    sessionGeneration: 1, languageDescriptor: "typescript" });
  return { target, tabKey, registry, registered, tab };
}

afterEach(() => {
  vi.restoreAllMocks();
  useEditorStore.setState({ tabs: [] });
  useSemanticNavigationStore.getState().setRevealIntent(null);
});

describe("semantic Monaco destination and coordinates", () => {
  it("maps UTF-16 coordinates without changing code-unit offsets", () => {
    expect(monacoPositionToLsp({ lineNumber: 3, column: 5 })).toEqual({ line: 2, character: 4 });
    expect(lspRangeToMonaco({ start: { line: 2, character: 4 }, end: { line: 4, character: 9 } })).toEqual({
      startLineNumber: 3, startColumn: 5, endLineNumber: 5, endColumn: 10,
    });
  });
  it("preserves actual profile/project/worktree for an unopened destination", () => {
    const { target, registered, tab } = fixture();
    const destination = resolveSemanticDestination(registered, "src/dest.ts", [tab]);
    expect(destination).toEqual({ target, relativePath: "src/dest.ts", tabKey: editorFileTabKey(target, "src/dest.ts") });
    expect(destination?.tabKey).not.toBe(editorFileTabKey({ ...target, worktreePath: null }, "src/dest.ts"));
  });
  it("fails closed without the exact live source tab, rather than parsing JSON positions", () => {
    const { registered, tab } = fixture();
    expect(resolveSemanticDestination(registered, "src/dest.ts", [])).toBeNull();
    expect(resolveSemanticDestination(registered, "src/dest.ts", [{ ...tab, targetAvailable: false }])).toBeNull();
    expect(resolveSemanticDestination(registered, "src/dest.ts", [{ ...tab, target: { ...tab.target, profileId: "other" } }])).toBeNull();
  });
});

describe("per-registration Monaco lifecycle", () => {
  it("keeps the second same-scope registration alive when the first unmounts", () => {
    const { registry, tabKey } = fixture();
    const providers: monaco.languages.DefinitionProvider[] = [];
    const dispose = vi.fn();
    vi.spyOn(monaco.languages, "registerDefinitionProvider").mockImplementation((selector, provider) => {
      expect(selector).toEqual(expect.objectContaining({ exclusive: true, scheme: "inmemory", language: "typescript" }));
      providers.push(provider); return { dispose };
    });
    vi.spyOn(monaco.languages, "registerImplementationProvider").mockReturnValue({ dispose: vi.fn() });
    const client = { getStatus: () => "ready", canAccessModel: (key: string) => key === tabKey } as SemanticClient;
    const manager = new SemanticMonacoManager({ registry });
    const first = manager.register({ getClientForModel: () => client });
    const second = manager.register({ getClientForModel: () => client });
    manager.activate();
    expect(providers).toHaveLength(1);
    first.dispose();
    first.dispose();
    expect(dispose).not.toHaveBeenCalled();
    second.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    manager.deactivate();
  });

  it("restores built-in eligibility by disposing only this model's selectors", () => {
    const { registry } = fixture();
    const dispose = vi.fn();
    vi.spyOn(monaco.languages, "registerDefinitionProvider").mockReturnValue({ dispose });
    vi.spyOn(monaco.languages, "registerImplementationProvider").mockReturnValue({ dispose });
    const client = { getStatus: () => "ready", canAccessModel: () => true } as SemanticClient;
    const manager = new SemanticMonacoManager({ registry, getClientForModel: () => client });
    manager.activate();
    registry.clearWireBindings("session-target");
    expect(dispose).toHaveBeenCalledTimes(2);
    manager.deactivate();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});

describe("semantic destination asynchronous fences", () => {
  it("rechecks the first destination after awaiting validation of a second destination", async () => {
    const { registry, target, tab, tabKey, registered } = fixture();
    const firstKey = editorFileTabKey(target, "src/first.ts");
    const secondKey = editorFileTabKey(target, "src/second.ts");
    for (const [key, path] of [[firstKey, "src/first.ts"], [secondKey, "src/second.ts"]]) {
      registry.registerModel({ tabKey: key, profileId: target.profileId, project: target.project,
        targetKey: tab.targetKey, relativePath: path });
    }
    const fakeModel = (key: string) => ({ uri: monaco.Uri.parse(`inmemory://dam-hopper/${encodeURIComponent(key)}`),
      getVersionId: vi.fn(() => 1), isDisposed: () => false, getValue: () => "exact destination text" });
    const source = fakeModel(tabKey);
    const first = fakeModel(firstKey);
    const second = fakeModel(secondKey);
    vi.spyOn(monaco.editor, "getModel").mockImplementation((uri) =>
      (uri.toString() === first.uri.toString() ? first : uri.toString() === second.uri.toString() ? second : null) as monaco.editor.ITextModel | null);
    const deferredProof = Promise.withResolvers<boolean>();
    const validate = vi.fn().mockResolvedValueOnce(true).mockReturnValueOnce(deferredProof.promise);
    const client = { getStatus: () => "ready", canAccessModel: () => true, validateDestination: validate,
      getDefinition: vi.fn().mockResolvedValue({ locations: ["first", "second"].map((name) => ({
        uri: `dam-hopper://semantic/session-target/src/${name}.ts`, damHopperDestinationContentSha256: "a".repeat(64),
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      })) }) } as unknown as SemanticClient;
    useEditorStore.setState({ tabs: [tab] });
    let provider!: monaco.languages.DefinitionProvider;
    vi.spyOn(monaco.languages, "registerDefinitionProvider").mockImplementation((_selector, value) => {
      provider = value; return { dispose() {} };
    });
    vi.spyOn(monaco.languages, "registerImplementationProvider").mockReturnValue({ dispose() {} });
    const manager = new SemanticMonacoManager({ registry, getClientForModel: () => client });
    manager.activate();
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    const navigation = provider.provideDefinition(source as unknown as monaco.editor.ITextModel, { lineNumber: 1, column: 1 }, token);
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(2));
    first.getVersionId.mockReturnValue(2);
    deferredProof.resolve(true);
    const result = await navigation as monaco.languages.Location[];
    expect(result).toHaveLength(1);
    expect(result[0].uri.toString()).toBe(second.uri.toString());
    expect(registry.getByTabKey(tabKey)).toBe(registered);
    manager.deactivate();
  });

  it("an older open completion cannot publish over a newer reveal intent", async () => {
    const { registry, target, tab, tabKey, registered } = fixture();
    useEditorStore.setState({ tabs: [tab] });
    let provider!: monaco.languages.DefinitionProvider;
    let opener!: monaco.editor.ICodeEditorOpener;
    vi.spyOn(monaco.languages, "registerDefinitionProvider").mockImplementation((_selector, value) => {
      provider = value; return { dispose() {} };
    });
    vi.spyOn(monaco.languages, "registerImplementationProvider").mockReturnValue({ dispose() {} });
    vi.spyOn(monaco.editor, "registerEditorOpener").mockImplementation((value) => { opener = value; return { dispose() {} }; });
    const location = (name: string) => ({ uri: `dam-hopper://semantic/session-target/src/${name}.ts`,
      damHopperDestinationContentSha256: "a".repeat(64), damHopperDestinationVersion: null,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } });
    const client = { getStatus: () => "ready", canAccessModel: () => true,
      getDefinition: vi.fn().mockResolvedValue({ locations: [location("first"), location("second")] }) } as unknown as SemanticClient;
    const manager = new SemanticMonacoManager({ registry, getClientForModel: () => client });
    const source = { uri: monaco.Uri.parse(registered.identity.localModelUri), getVersionId: () => 1, isDisposed: () => false };
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    manager.activate();
    const results = await provider.provideDefinition(source as unknown as monaco.editor.ITextModel,
      { lineNumber: 1, column: 1 }, token) as monaco.languages.Location[];
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    vi.spyOn(useEditorStore.getState(), "open").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const editor = { getModel: () => source } as unknown as monaco.editor.ICodeEditor;
    const openingFirst = opener.openCodeEditor(editor, results[0].uri, results[0].range);
    const openingSecond = opener.openCodeEditor(editor, results[1].uri, results[1].range);
    useEditorStore.setState({ tabs: [tab, ...["first", "second"].map((name) => ({
      ...tab, key: editorFileTabKey(target, `src/${name}.ts`), path: `src/${name}.ts`,
    }))] });
    second.resolve(); await openingSecond;
    const expected = useSemanticNavigationStore.getState().activeRevealIntent;
    expect(expected?.relativePath).toBe("src/second.ts");
    first.resolve(); await openingFirst;
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBe(expected);
    expect(expected?.isCurrent?.()).toBe(true);
    expect(tabKey).toBe(editorFileTabKey(target, tab.path));
    manager.deactivate();
  });

  it("consumes retired semantic results without intercepting an unowned source", async () => {
    const { registry, registered, tab } = fixture();
    useEditorStore.setState({ tabs: [tab] });
    let opener!: monaco.editor.ICodeEditorOpener;
    vi.spyOn(monaco.languages, "registerDefinitionProvider").mockReturnValue({ dispose() {} });
    vi.spyOn(monaco.languages, "registerImplementationProvider").mockReturnValue({ dispose() {} });
    vi.spyOn(monaco.editor, "registerEditorOpener").mockImplementation((value) => {
      opener = value;
      return { dispose() {} };
    });
    const manager = new SemanticMonacoManager({ registry });
    manager.activate();
    const source = { getModel: () => ({ uri: monaco.Uri.parse(registered.identity.localModelUri) }) } as monaco.editor.ICodeEditor;
    const destination = monaco.Uri.parse("inmemory://dam-hopper/retired-destination");
    expect(await opener.openCodeEditor(source, destination, { lineNumber: 1, column: 1 })).toBe(true);
    const unowned = { getModel: () => ({ uri: monaco.Uri.parse("inmemory://scratch/unowned.ts") }) } as monaco.editor.ICodeEditor;
    expect(await opener.openCodeEditor(unowned, destination, { lineNumber: 1, column: 1 })).toBe(false);
    expect(await opener.openCodeEditor(source, monaco.Uri.parse("file:///unrelated.ts"))).toBe(false);
    manager.deactivate();
  });
});

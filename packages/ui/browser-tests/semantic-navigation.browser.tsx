import "@/lib/monaco-setup.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import * as monaco from "monaco-editor";
import { SemanticMonacoManager } from "@/lib/semantic-monaco.js";
import { SemanticModelRegistry, buildLocalModelUri, computeUtf8Sha256Hex } from "@/lib/semantic-model-uri.js";
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import type { SemanticClient } from "@/api/semantic-client.js";
import { useSemanticNavigationStore } from "@/stores/semantic-navigation.js";
import "@/index.css";

// Observe real built-in adapters, preserving their actual worker implementation.
// Monaco 0.55.1 ships a DefinitionAdapter, but no built-in ImplementationAdapter.
const builtinDefinitions = new Map<string, MockInstance<monaco.languages.DefinitionProvider["provideDefinition"]>>();
const registerDefinition = monaco.languages.registerDefinitionProvider.bind(monaco.languages);
vi.spyOn(monaco.languages, "registerDefinitionProvider").mockImplementation((selector, provider) => {
  if (typeof selector === "string" && ["typescript", "javascript"].includes(selector)) {
    builtinDefinitions.set(selector, vi.spyOn(provider, "provideDefinition"));
  }
  return registerDefinition(selector, provider);
});

describe("semantic Monaco real actions (UI boundary, not packaged-server qualification)", () => {
  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor;
  let registry: SemanticModelRegistry;
  let manager: SemanticMonacoManager;
  const disposables: monaco.IDisposable[] = [];
  const models: monaco.editor.ITextModel[] = [];
  const target = { profileId: "browser-profile", project: "browser-project", worktreePath: "/worktrees/browser-feature" };
  const text = "const value = 1;\nvalue;\nconst semanticTarget = 2;\n";
  let destinationHash: string;

  async function readyBuiltin(language: "typescript" | "javascript", model: monaco.editor.ITextModel) {
    await vi.waitFor(() => expect(builtinDefinitions.has(language)).toBe(true), { timeout: 20_000 });
    const getWorker = language === "typescript"
      ? monaco.languages.typescript.getTypeScriptWorker
      : monaco.languages.typescript.getJavaScriptWorker;
    const workerFactory = await getWorker();
    const worker = await workerFactory(model.uri);
    await worker.getDefinitionAtPosition(model.uri.toString(), model.getOffsetAt({ lineNumber: 2, column: 3 }));
    const builtin = builtinDefinitions.get(language)!;
    builtin.mockClear();
    return builtin;
  }

  beforeAll(async () => {
    for (const language of ["typescript", "javascript"] as const) {
      const ext = language === "typescript" ? "ts" : "js";
      const warmupModel = monaco.editor.createModel(text, language, monaco.Uri.parse(`inmemory://warmup/main.${ext}`));
      try {
        await readyBuiltin(language, warmupModel);
      } finally {
        warmupModel.dispose();
      }
    }
  }, 30_000);

  beforeEach(async () => {
    destinationHash = await computeUtf8Sha256Hex(text);
    container = document.createElement("div");
    Object.assign(container.style, { width: "800px", height: "500px" });
    document.body.appendChild(container);
    registry = new SemanticModelRegistry();
    useSemanticNavigationStore.getState().setRevealIntent(null);
    manager = new SemanticMonacoManager({ registry });
    useEditorStore.setState({ tabs: [], activeKeys: {} });
    for (const spy of builtinDefinitions.values()) spy.mockClear();
  });
  afterEach(() => {
    manager.deactivate();
    for (const disposable of disposables.splice(0)) disposable.dispose();
    editor?.setModel(null);
    editor?.dispose();
    for (const model of models.splice(0)) model.dispose();
    container.remove();
    useEditorStore.setState({ tabs: [], activeKeys: {} });
  });
  function create(language: "typescript" | "javascript", owned: boolean) {
    const path = language === "typescript" ? "src/main.ts" : "src/main.js";
    const tabKey = editorFileTabKey(target, path);
    const model = monaco.editor.createModel(text, language,
      monaco.Uri.parse(owned ? buildLocalModelUri(tabKey) : `inmemory://scratch/${path}`));
    models.push(model);
    const tab = { key: tabKey, target, project: target.project, targetKey: "worktree:/worktrees/browser-feature",
      targetAvailable: true, path, content: text, savedContent: text, dirty: false } as Tab;
    useEditorStore.setState({ tabs: [tab] });
    const registered = registry.registerModel({ tabKey, profileId: target.profileId, project: target.project,
      targetKey: tab.targetKey, relativePath: path });
    registry.bindWire(tabKey, { targetId: "browser-target", connectionGeneration: 1, targetGeneration: 1,
      sessionGeneration: 1, languageDescriptor: language });
    const client = {
      canAccessModel: (key: string) => !!registry.getByTabKey(key),
      getStatus: () => "ready",
      validateDestination: async (_location: unknown, _key: string, content: string) => await computeUtf8Sha256Hex(content) === destinationHash,
      getDefinition: vi.fn().mockResolvedValue({ locations: [{ uri: `dam-hopper://semantic/browser-target/${path}`,
        damHopperDestinationContentSha256: destinationHash, damHopperDestinationVersion: 1,
        range: { start: { line: 2, character: 6 }, end: { line: 2, character: 20 } } }] }),
      getImplementation: vi.fn().mockResolvedValue({ locations: [{ uri: `dam-hopper://semantic/browser-target/${path}`,
        damHopperDestinationContentSha256: destinationHash, damHopperDestinationVersion: 1,
        range: { start: { line: 2, character: 6 }, end: { line: 2, character: 20 } } }] }),
    };
    editor = monaco.editor.create(container, { model, automaticLayout: true,
      gotoLocation: { multipleDefinitions: "peek", multipleImplementations: "peek" },
      minimap: { enabled: false }, occurrencesHighlight: "off", inlayHints: { enabled: "off" },
      codeLens: false, links: false });
    return { model, tabKey, registered, client };
  }

  async function action(id: string) {
    editor.focus();
    editor.setPosition({ lineNumber: 2, column: 3 });
    editor.trigger("semantic-browser-test", id, {});
    await vi.waitFor(() => {
      const completed = editor.getPosition()?.lineNumber !== 2 ||
        useSemanticNavigationStore.getState().activeRevealIntent !== null ||
        container.querySelector(".monaco-editor-overlaymessage") !== null;
      expect(completed, `actual Monaco command ${id} completion`).toBe(true);
    }, { timeout: 10_000 });
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 0);
    await settled.promise;
  }

  for (const language of ["typescript", "javascript"] as const) {
    it(`${language}: owned Definition excludes actual built-in; nonowned and OFF restore it`, async () => {
      const { model, client } = create(language, true);
      const builtin = await readyBuiltin(language, model);
      const first = manager.register({ getClientForModel: () => client as unknown as SemanticClient });
      const surviving = manager.register({ getClientForModel: () => client as unknown as SemanticClient });
      manager.activate();
      first.dispose();
      await action("editor.action.revealDefinition");
      expect(client.getDefinition).toHaveBeenCalledTimes(1);
      expect(builtin).not.toHaveBeenCalled();
      expect(editor.getPosition()?.lineNumber).toBe(3);
      expect(container.querySelector(".peekview-widget")).toBeNull();
      surviving.dispose();
      manager.deactivate();
      await action("editor.action.revealDefinition");
      expect(builtin).toHaveBeenCalled();
      expect(editor.getPosition()?.lineNumber).toBe(1);
      expect(editor.getModel()).toBe(model);
      expect(model.getValue()).toBe(text);
    });

    it(`${language}: nonowned Definition retains actual built-in while manager is ON`, async () => {
      const { model, client } = create(language, false);
      const builtin = await readyBuiltin(language, model);
      manager.register({ getClientForModel: () => client as unknown as SemanticClient });
      manager.activate();
      await action("editor.action.revealDefinition");
      expect(client.getDefinition).not.toHaveBeenCalled();
      expect(builtin).toHaveBeenCalled();
      expect(editor.getPosition()?.lineNumber).toBe(1);
    });

    it(`${language}: Implementation excludes competing provider only for owned model`, async () => {
      const { model, client } = create(language, true);
      const competing = vi.fn((current: monaco.editor.ITextModel) => [{ uri: current.uri,
        range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 } }]);
      disposables.push(monaco.languages.registerImplementationProvider(language, { provideImplementation: competing }));
      manager.register({ getClientForModel: () => client as unknown as SemanticClient });
      manager.activate();
      await action("editor.action.goToImplementation");
      expect(client.getImplementation).toHaveBeenCalledTimes(1);
      expect(competing).not.toHaveBeenCalled();
      expect(editor.getPosition()?.lineNumber).toBe(3);
      registry.clearWireBindings("browser-target");
      await action("editor.action.goToImplementation");
      expect(competing).toHaveBeenCalledTimes(1);
      expect(editor.getPosition()?.lineNumber).toBe(1);
      expect(editor.getModel()).toBe(model);
    });
  }

  it("an actual Definition action opens an unopened destination in the source worktree, carrying its proof", async () => {
    const { client } = create("typescript", true);
    client.getDefinition.mockResolvedValue({ locations: [{
      uri: "dam-hopper://semantic/browser-target/src/destination.ts",
      range: { start: { line: 2, character: 6 }, end: { line: 2, character: 20 } },
      damHopperDestinationContentSha256: destinationHash, damHopperDestinationVersion: null,
    }] });
    const open = vi.spyOn(useEditorStore.getState(), "open").mockImplementation(async () => {
      const source = useEditorStore.getState().tabs[0];
      useEditorStore.setState({ tabs: [source, { ...source, key: editorFileTabKey(target, "src/destination.ts"), path: "src/destination.ts" }] });
    });
    disposables.push({ dispose: () => open.mockRestore() });
    manager.register({ getClientForModel: () => client as unknown as SemanticClient });
    manager.activate();
    await action("editor.action.revealDefinition");
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toEqual(expect.objectContaining({
      profileId: target.profileId, project: target.project, relativePath: "src/destination.ts",
      destinationContentSha256: destinationHash, destinationVersion: null,
    }));
    expect(open).toHaveBeenCalledWith(target, expect.objectContaining({ id: "src/destination.ts" }));
  });

  it("a destination edit during awaited proof validation prevents actual Monaco navigation", async () => {
    const { client } = create("typescript", true);
    const destinationKey = editorFileTabKey(target, "src/destination.ts");
    const destinationModel = monaco.editor.createModel(text, "typescript", monaco.Uri.parse(buildLocalModelUri(destinationKey)));
    models.push(destinationModel);
    registry.registerModel({ tabKey: destinationKey, profileId: target.profileId, project: target.project,
      targetKey: "worktree:/worktrees/browser-feature", relativePath: "src/destination.ts" });
    client.getDefinition.mockResolvedValue({ locations: [{
      uri: "dam-hopper://semantic/browser-target/src/destination.ts",
      range: { start: { line: 2, character: 6 }, end: { line: 2, character: 20 } },
      damHopperDestinationContentSha256: destinationHash, damHopperDestinationVersion: null,
    }] });
    const proof = Promise.withResolvers<boolean>();
    const validate = vi.spyOn(client, "validateDestination").mockReturnValueOnce(proof.promise);
    manager.register({ getClientForModel: () => client as unknown as SemanticClient });
    manager.activate();
    const navigation = action("editor.action.revealDefinition");
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
    destinationModel.applyEdits([{ range: new monaco.Range(1, 1, 1, 1), text: "// changed\n" }]);
    proof.resolve(true);
    await navigation;
    expect(editor.getModel()).not.toBe(destinationModel);
    expect(editor.getPosition()?.lineNumber).toBe(2);
  });

  it("same-binding reconnect preserves actual Monaco model, dirty text, undo and view state", async () => {
    const { model, tabKey } = create("typescript", true);
    editor.setPosition({ lineNumber: 2, column: 3 });
    model.pushStackElement();
    editor.executeEdits("user", [{ range: new monaco.Range(1, 1, 1, 1), text: "// unsaved\n" }]);
    model.pushStackElement();
    editor.setSelection(new monaco.Range(3, 1, 3, 4));
    const before = editor.saveViewState();
    const dirty = model.getValue();
    registry.clearWireBindings("browser-target");
    registry.bindWire(tabKey, { targetId: "browser-reconnected", connectionGeneration: 2,
      targetGeneration: 1, sessionGeneration: 2, languageDescriptor: "typescript" });
    expect(editor.getModel()).toBe(model);
    expect(model.getValue()).toBe(dirty);
    expect(editor.saveViewState()).toEqual(before);
    await model.undo();
    expect(model.getValue()).toBe(text);
    await model.redo();
    expect(model.getValue()).toBe(dirty);
  });
});

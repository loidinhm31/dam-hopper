import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as monacoNs from "monaco-editor";
import { MonacoHost } from "@/components/organisms/MonacoHost.js";
import {
  PrewarmIntentHarness,
  selectVirtualTarget,
  virtualizeNavigationResult,
} from "@/lib/semantic-navigation-compat-harness.js";
import type { SemanticNavigationTarget } from "@dam-hopper/shared";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const targetUri = "dam-hopper://profile-a/project-a/src/target.rs";

describe("semantic navigation public Monaco compatibility", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editor: monacoNs.editor.IStandaloneCodeEditor | null = null;
  let monaco: typeof monacoNs | null = null;
  let sourceModel: monacoNs.editor.ITextModel | null = null;

  beforeEach(async () => {
    container = document.createElement("div");
    container.style.cssText = "width: 800px; height: 400px";
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="semantic-compat"
          content="fn source() { target(); }"
          path="src/main.rs"
          mime="text/rust"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={() => {}}
          onEditorReady={(value) => {
            editor = value;
            sourceModel = value?.getModel() ?? null;
          }}
          onMonacoReady={(value) => {
            monaco = value;
          }}
        />,
      );
    });
    await vi.waitFor(() => expect(editor).not.toBeNull());
    expect(monaco).not.toBeNull();
    expect(sourceModel).not.toBeNull();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    sourceModel?.dispose();
    container.remove();
    editor = null;
    monaco = null;
    sourceModel = null;
  });

  function installInputProviders(api: typeof monacoNs) {
    const calls = { definition: 0, implementation: 0, references: 0 };
    const seenModels = new Set<string>();
    const languages = ["rust", "typescript", "javascript", "java"];
    const definition = {
      provideDefinition: (
        model: monacoNs.editor.ITextModel,
        _position: monacoNs.Position,
        token: monacoNs.CancellationToken,
      ) => {
        expect("isCancellationRequested" in token).toBe(true);
        seenModels.add(model.getValue());
        calls.definition += 1;
        return null;
      },
    };
    const implementation = {
      provideImplementation: (
        model: monacoNs.editor.ITextModel,
        _position: monacoNs.Position,
        token: monacoNs.CancellationToken,
      ) => {
        expect("isCancellationRequested" in token).toBe(true);
        seenModels.add(model.getValue());
        calls.implementation += 1;
        return null;
      },
    };
    const references = {
      provideReferences: (
        model: monacoNs.editor.ITextModel,
        _position: monacoNs.Position,
        context: monacoNs.languages.ReferenceContext,
        token: monacoNs.CancellationToken,
      ) => {
        expect(context.includeDeclaration).toBe(true);
        expect("isCancellationRequested" in token).toBe(true);
        seenModels.add(model.getValue());
        calls.references += 1;
        return null;
      },
    };
    const disposables = languages.flatMap((language) => [
      api.languages.registerDefinitionProvider(language, definition),
      api.languages.registerImplementationProvider(language, implementation),
      api.languages.registerReferenceProvider(language, references),
    ]);
    return {
      calls,
      seenModels,
      definition,
      implementation,
      references,
      dispose: () => disposables.forEach((item) => item.dispose()),
    };
  }

  function editorPoint(host: monacoNs.editor.IStandaloneCodeEditor) {
    const visible = host.getScrolledVisiblePosition({
      lineNumber: 1,
      column: 5,
    });
    return {
      x: (visible?.left ?? 0) + 2,
      y: (visible?.top ?? 0) + (visible?.height ?? 0) / 2,
    };
  }

  it("freezes Gate B by retaining only unopened-target metadata", () => {
    const api = monaco as typeof monacoNs;
    const target = api.Uri.parse(targetUri);
    const dirtyUri = api.Uri.parse(
      "dam-hopper://profile-a/project-a/src/dirty.rs",
    );
    const dirty = api.editor.createModel(
      "fn source() { target(); }",
      "rust",
      dirtyUri,
    );

    try {
      dirty.setValue("fn source() { target(); }\n// unsaved edit");
      expect(dirty.getValue()).toContain("// unsaved edit");
      expect(dirty.uri).toEqual(dirtyUri);
      expect(api.editor.getModel(target)).toBeNull();
      expect(api.editor.getModels()).toContain(sourceModel);
    } finally {
      dirty.dispose();
    }
  });

  it("registers public providers without standalone action execution", () => {
    const api = monaco as typeof monacoNs;
    const providers = installInputProviders(api);
    try {
      const source = sourceModel as monacoNs.editor.ITextModel;
      const position = new api.Position(1, 5);
      const token = {
        isCancellationRequested: false,
      } as monacoNs.CancellationToken;
      expect(
        providers.definition.provideDefinition(source, position, token),
      ).toBeNull();
      expect(
        providers.implementation.provideImplementation(source, position, token),
      ).toBeNull();
      expect(
        providers.references.provideReferences(
          source,
          position,
          { includeDeclaration: true },
          token,
        ),
      ).toBeNull();
      expect(providers.calls).toEqual({
        definition: 1,
        implementation: 1,
        references: 1,
      });
      expect(providers.seenModels).toContain("fn source() { target(); }");
      expect(api.editor.getModels()).toHaveLength(1);
    } finally {
      providers.dispose();
    }
  });

  it("captures native navigation input without invoking unavailable standalone resolution", async () => {
    const host = editor as monacoNs.editor.IStandaloneCodeEditor;
    const observed: string[] = [];
    const capture = (event: Event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key === "F12") {
        observed.push(
          `key:${keyboard.ctrlKey ? "ctrl+" : ""}${keyboard.shiftKey ? "shift+" : ""}F12`,
        );
      }
      if (
        event.type === "mousedown" &&
        (keyboard.ctrlKey || keyboard.metaKey) &&
        keyboard.button === 0
      ) {
        observed.push("modifier-click");
      }
      if (event.type === "contextmenu") observed.push("context-action");
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("keydown", capture, true);
    document.addEventListener("mousedown", capture, true);
    document.addEventListener("contextmenu", capture, true);
    try {
      for (const modifiers of [{}, { ctrlKey: true }, { shiftKey: true }]) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "F12",
            ...modifiers,
          }),
        );
      }
      const point = editorPoint(host);
      const target = host.getDomNode() as HTMLElement;
      target.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: point.x,
          clientY: point.y,
          [/Mac/i.test(navigator.platform) ? "metaKey" : "ctrlKey"]: true,
        }),
      );
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: point.x,
          clientY: point.y,
        }),
      );
      expect(observed).toEqual(
        expect.arrayContaining([
          "key:F12",
          "key:ctrl+F12",
          "key:shift+F12",
          "modifier-click",
          "context-action",
        ]),
      );
    } finally {
      document.removeEventListener("keydown", capture, true);
      document.removeEventListener("mousedown", capture, true);
      document.removeEventListener("contextmenu", capture, true);
    }
  });

  it("uses virtualized metadata results and opens only an explicit selection", () => {
    const api = monaco as typeof monacoNs;
    const modelCount = api.editor.getModels().length;
    const target = (index: number): SemanticNavigationTarget => ({
      uri: {
        profileId: "profile-a",
        projectId: "project-a",
        path: `src/target-${index}.rs`,
        language: "rust",
      },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      label: `target-${index}`,
    });
    const opened: SemanticNavigationTarget[] = [];
    const many = virtualizeNavigationResult(
      "ready",
      Array.from({ length: 501 }, (_, index) => target(index)),
    );

    expect(many).toMatchObject({ kind: "targets", capped: true });
    expect(many.kind === "targets" && many.targets).toHaveLength(500);
    expect(api.editor.getModels()).toHaveLength(modelCount);
    selectVirtualTarget(many, 499, (selection) => opened.push(selection));
    expect(opened).toEqual([target(499)]);
    expect(virtualizeNavigationResult("ready", null)).toEqual({
      kind: "empty",
    });
    expect(virtualizeNavigationResult("bundleUnavailable", [])).toEqual({
      kind: "unavailable",
      state: "bundleUnavailable",
    });
    expect(virtualizeNavigationResult("restricted", [])).toEqual({
      kind: "unavailable",
      state: "restricted",
    });
  });

  it("keeps prewarm local, key-scoped, and cancellable before 750ms", () => {
    vi.useFakeTimers();
    const intent = vi.fn();
    const controller = new PrewarmIntentHarness();
    const base = {
      profileId: "profile",
      workspaceId: "workspace",
      projectId: "project",
      language: "rust" as const,
      tabGeneration: 1,
    };

    const eligible = { supported: true, hydrated: true, active: true };
    controller.schedule(base, eligible, intent);
    vi.advanceTimersByTime(749);
    expect(intent).not.toHaveBeenCalled();
    controller.cancel(); // tab switch, edit reload, unmount, or identity change
    vi.advanceTimersByTime(1);
    expect(intent).not.toHaveBeenCalled();

    const next = { ...base, projectId: "next-project", tabGeneration: 2 };
    controller.schedule(next, eligible, intent);
    vi.advanceTimersByTime(750);
    expect(intent).toHaveBeenCalledTimes(1);
    expect(intent).toHaveBeenCalledWith(next);
    controller.schedule(base, { ...eligible, supported: false }, intent);
    controller.schedule(base, { ...eligible, hydrated: false }, intent);
    controller.schedule(base, { ...eligible, active: false }, intent);
    vi.advanceTimersByTime(750);
    expect(intent).toHaveBeenCalledTimes(1);
    controller.navigate(base, intent);
    expect(intent).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

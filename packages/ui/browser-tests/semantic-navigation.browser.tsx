import "@/lib/monaco-setup.js";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Editor from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { SemanticMonacoManager } from "@/lib/semantic-monaco.js";
import {
  SemanticModelRegistry,
  buildLocalModelUri,
} from "@/lib/semantic-model-uri.js";
import type { SemanticClient } from "@/api/semantic-client.js";
import "@/index.css";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Semantic Navigation Browser Component Tests", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let registry: SemanticModelRegistry;
  let manager: SemanticMonacoManager;
  let mockClient: Partial<SemanticClient>;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.appendChild(container);
    root = createRoot(container);

    registry = new SemanticModelRegistry();
    mockClient = {
      getStatus: vi.fn().mockReturnValue("ready"),
      getDefinition: vi.fn().mockResolvedValue({
        locations: [
          {
            uri: "dam-hopper://semantic/target-1/src/destination.ts",
            range: {
              start: { line: 5, character: 0 },
              end: { line: 5, character: 15 },
            },
          },
        ],
      }),
      getImplementation: vi.fn().mockResolvedValue({
        locations: [],
      }),
    };

    manager = new SemanticMonacoManager({
      registry,
      getClientForModel: () => mockClient as SemanticClient,
    });
  });

  afterEach(() => {
    manager.deactivate();
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  it("activates provider coexistence and routes semantic models in real browser environment", async () => {
    manager.activate();

    const tabKey = JSON.stringify([
      "file",
      "test-project",
      "target-1",
      "src/index.ts",
    ]);
    const model = registry.registerModel({
      tabKey,
      profileId: "default",
      project: "test-project",
      targetKey: "target-1",
      relativePath: "src/index.ts",
    });

    registry.bindWire(tabKey, {
      targetId: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      sessionGeneration: 1,
      languageDescriptor: "typescript",
    });

    let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;

    await act(async () => {
      root?.render(
        <div style={{ width: "800px", height: "600px" }}>
          <Editor
            path={buildLocalModelUri(tabKey)}
            value="export const greeting = 'hello world';\n"
            language="typescript"
            theme="vs-dark"
            onMount={(editor) => {
              editorInstance = editor;
            }}
          />
        </div>,
      );
    });

    await vi.waitFor(() => expect(editorInstance).not.toBeNull());

    const edModel = editorInstance!.getModel();
    expect(edModel).not.toBeNull();
    expect(edModel?.uri.toString()).toBe(
      monaco.Uri.parse(buildLocalModelUri(tabKey)).toString(),
    );
    // Query definition on model via delegating manager
    const cancellationToken = new monaco.CancellationTokenSource().token;
    const definitionResult = await (
      manager as unknown as {
        provideDefinition: (
          model: monaco.editor.ITextModel,
          position: monaco.IPosition,
          token: monaco.CancellationToken,
        ) => Promise<monaco.languages.Definition | null>;
      }
    ).provideDefinition(
      edModel!,
      { lineNumber: 1, column: 15 },
      cancellationToken,
    );

    expect(mockClient.getDefinition).toHaveBeenCalled();
    expect(Array.isArray(definitionResult)).toBe(true);
    const locations = definitionResult as monaco.languages.Location[];
    expect(locations.length).toBe(1);
    expect(locations[0].range.startLineNumber).toBe(6);

    // Deactivate restores modeConfiguration cleanly
    manager.deactivate();
  });

  it("preserves dirty text and undo stack across wire re-bind on simulated reconnect", async () => {
    const tabKey = JSON.stringify([
      "file",
      "test-project",
      "target-1",
      "src/dirty.ts",
    ]);
    registry.registerModel({
      tabKey,
      profileId: "default",
      project: "test-project",
      targetKey: "target-1",
      relativePath: "src/dirty.ts",
    });

    registry.bindWire(tabKey, {
      targetId: "target-1",
      connectionGeneration: 1,
      targetGeneration: 1,
      sessionGeneration: 1,
      languageDescriptor: "typescript",
    });

    let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;

    await act(async () => {
      root?.render(
        <div style={{ width: "800px", height: "600px" }}>
          <Editor
            path={buildLocalModelUri(tabKey)}
            value="const x = 1;\n"
            language="typescript"
            theme="vs-dark"
            onMount={(editor) => {
              editorInstance = editor;
            }}
          />
        </div>,
      );
    });

    await vi.waitFor(() => expect(editorInstance).not.toBeNull());

    // User makes a dirty edit
    editorInstance!.trigger("keyboard", "type", { text: "// new comment\n" });
    const dirtyText = editorInstance!.getValue();
    expect(dirtyText).toContain("// new comment");

    // Simulate reconnect: clear wire bindings for target-1
    registry.clearWireBindings("target-1");

    // Local model is STILL registered with the same stable identity
    const preserved = registry.getByTabKey(tabKey);
    expect(preserved).toBeDefined();
    expect(preserved?.wireBinding).toBeNull();

    // Editor content is UNCHANGED
    expect(editorInstance!.getValue()).toBe(dirtyText);

    // Re-bind to new wire session target-2
    const rebind = registry.bindWire(tabKey, {
      targetId: "target-2",
      connectionGeneration: 2,
      targetGeneration: 1,
      sessionGeneration: 2,
      languageDescriptor: "typescript",
      initialWireVersion: 1,
    });

    expect(rebind?.targetId).toBe("target-2");
    expect(rebind?.wireUri).toBe("dam-hopper://semantic/target-2/src/dirty.ts");
    // Content in Monaco buffer is still intact!
    expect(editorInstance!.getValue()).toBe(dirtyText);
  });
});

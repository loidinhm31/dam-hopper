// @vitest-environment jsdom
import { vi } from "vitest";

vi.hoisted(() => {
  if (
    typeof document !== "undefined" &&
    !("queryCommandSupported" in document)
  ) {
    (document as unknown as Record<string, unknown>).queryCommandSupported =
      () => false;
  }
  if (typeof window !== "undefined" && !window.CSS) {
    (window as unknown as Record<string, unknown>).CSS = {
      escape: (s: string) => s,
    };
  }
  if (typeof window !== "undefined" && !window.matchMedia) {
    (window as unknown as Record<string, unknown>).matchMedia = () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
});
import "@/lib/monaco-setup.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as monaco from "monaco-editor";
import {
  monacoPositionToLsp,
  lspRangeToMonaco,
  SemanticMonacoManager,
} from "./semantic-monaco.js";
import { SemanticModelRegistry } from "./semantic-model-uri.js";
import type { SemanticClient } from "@/api/semantic-client.js";

describe("semantic-monaco", () => {
  describe("coordinate conversions", () => {
    it("converts Monaco 1-based position to LSP 0-based position", () => {
      expect(monacoPositionToLsp({ lineNumber: 1, column: 1 })).toEqual({
        line: 0,
        character: 0,
      });
      expect(monacoPositionToLsp({ lineNumber: 42, column: 15 })).toEqual({
        line: 41,
        character: 14,
      });
      expect(monacoPositionToLsp({ lineNumber: 0, column: 0 })).toEqual({
        line: 0,
        character: 0,
      });
    });

    it("converts LSP 0-based range to Monaco 1-based range", () => {
      const lspRange = {
        start: { line: 0, character: 5 },
        end: { line: 2, character: 10 },
      };
      expect(lspRangeToMonaco(lspRange)).toEqual({
        startLineNumber: 1,
        startColumn: 6,
        endLineNumber: 3,
        endColumn: 11,
      });
    });
  });

  describe("SemanticMonacoManager activation and deactivation", () => {
    let registry: SemanticModelRegistry;
    let manager: SemanticMonacoManager;

    beforeEach(() => {
      registry = new SemanticModelRegistry();
      manager = new SemanticMonacoManager({ registry });
    });

    afterEach(() => {
      manager.deactivate();
    });

    it("activates providers and restores on deactivation", () => {
      const spyRegisterDef = vi.spyOn(
        monaco.languages,
        "registerDefinitionProvider",
      );
      const spyRegisterImp = vi.spyOn(
        monaco.languages,
        "registerImplementationProvider",
      );

      manager.activate();
      expect(spyRegisterDef).toHaveBeenCalledTimes(2); // "typescript" and "javascript"
      expect(spyRegisterImp).toHaveBeenCalledTimes(2);

      // Deactivate
      manager.deactivate();
      // Second deactivation is idempotent
      manager.deactivate();

      spyRegisterDef.mockRestore();
      spyRegisterImp.mockRestore();
    });
  });

  describe("Model-scoped definition routing", () => {
    let registry: SemanticModelRegistry;
    let manager: SemanticMonacoManager;
    let mockClient: Partial<SemanticClient>;

    beforeEach(() => {
      registry = new SemanticModelRegistry();
      mockClient = {
        getStatus: vi.fn().mockReturnValue("ready"),
        getDefinition: vi.fn().mockResolvedValue({
          locations: [
            {
              uri: "dam-hopper://semantic/target-1/src/target.ts",
              range: {
                start: { line: 10, character: 4 },
                end: { line: 10, character: 14 },
              },
            },
          ],
        }),
      };

      manager = new SemanticMonacoManager({
        registry,
        getClientForModel: () => mockClient as SemanticClient,
      });
    });

    afterEach(() => {
      manager.deactivate();
    });

    it("routes registered semantic model to SemanticClient", async () => {
      const tabKey = "tab-main";
      const model = registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "test-proj",
        targetKey: "target-1",
        relativePath: "src/main.ts",
      });

      registry.bindWire(tabKey, {
        targetId: "target-1",
        connectionGeneration: 1,
        targetGeneration: 1,
        sessionGeneration: 1,
        languageDescriptor: "typescript",
      });

      // Spy on registerDefinitionProvider to capture the provider callback
      let capturedProvider: monaco.languages.DefinitionProvider | null = null;
      const spy = vi
        .spyOn(monaco.languages, "registerDefinitionProvider")
        .mockImplementation((lang, provider) => {
          if (lang === "typescript") {
            capturedProvider = provider;
          }
          return { dispose: vi.fn() };
        });

      manager.activate();
      expect(capturedProvider).not.toBeNull();

      // Create a mock Monaco model with the registered local URI
      const fakeModel = {
        uri: monaco.Uri.parse(model.identity.localModelUri),
        getLanguageId: () => "typescript",
        getOffsetAt: () => 0,
      } as unknown as monaco.editor.ITextModel;

      const cancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as monaco.CancellationToken;

      const result = await capturedProvider!.provideDefinition(
        fakeModel,
        { lineNumber: 5, column: 10 } as monaco.IPosition,
        cancellationToken,
      );

      expect(mockClient.getDefinition).toHaveBeenCalledWith(
        tabKey,
        { line: 4, character: 9 },
        cancellationToken,
      );

      expect(Array.isArray(result)).toBe(true);
      const locations = result as monaco.languages.Location[];
      expect(locations.length).toBe(1);
      expect(locations[0].range).toEqual({
        startLineNumber: 11,
        startColumn: 5,
        endLineNumber: 11,
        endColumn: 15,
      });

      spy.mockRestore();
    });

    it("returns null when navigation result is outside target", async () => {
      vi.mocked(mockClient.getDefinition!).mockResolvedValue({
        locations: [],
        outsideTarget: true,
      });

      const tabKey = "tab-main";
      const model = registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "test-proj",
        targetKey: "target-1",
        relativePath: "src/main.ts",
      });

      registry.bindWire(tabKey, {
        targetId: "target-1",
        connectionGeneration: 1,
        targetGeneration: 1,
        sessionGeneration: 1,
        languageDescriptor: "typescript",
      });

      let capturedProvider: monaco.languages.DefinitionProvider | null = null;
      const spy = vi
        .spyOn(monaco.languages, "registerDefinitionProvider")
        .mockImplementation((lang, provider) => {
          if (lang === "typescript") capturedProvider = provider;
          return { dispose: vi.fn() };
        });

      manager.activate();

      const fakeModel = {
        uri: monaco.Uri.parse(model.identity.localModelUri),
        getLanguageId: () => "typescript",
        getOffsetAt: () => 0,
      } as unknown as monaco.editor.ITextModel;

      const cancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      } as unknown as monaco.CancellationToken;

      const result = await capturedProvider!.provideDefinition(
        fakeModel,
        { lineNumber: 1, column: 1 } as monaco.IPosition,
        cancellationToken,
      );

      expect(result).toBeNull();
      spy.mockRestore();
    });
  });
});

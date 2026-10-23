/**
 * Semantic Monaco Integration — model-scoped Definition and Implementation providers
 * for TypeScript and JavaScript.
 *
 * Invariants:
 * - Translates between Monaco 1-based coordinates and LSP 0-based UTF-16 coordinates.
 * - Model-scoped: routes semantic models to SemanticClient, non-semantic models
 *   (e.g. diffs, scratchpads) to Monaco's built-in TS/JS worker.
 * - Prevents duplicate entries in Monaco's peek / navigation UI.
 * - Clean restoration of default Monaco mode configuration when deactivated or OFF.
 */

import * as monaco from "monaco-editor";
import type {
  SemanticClient,
  SemanticLocation,
} from "@/api/semantic-client.js";
import {
  type SemanticModelRegistry,
  type RegisteredModel,
  defaultSemanticModelRegistry,
  parseSemanticWireUri,
  buildLocalModelUri,
  monacoPositionToLsp,
  lspRangeToMonaco,
  type MonacoPositionLike,
  type MonacoRangeLike,
} from "./semantic-model-uri.js";
import { editorFileTabKey } from "@/stores/editor.js";
import type { ProjectTargetInput } from "@/api/client.js";
import {
  registerSemanticToggleListener,
  useSemanticNavigationStore,
} from "@/stores/semantic-navigation.js";

export {
  monacoPositionToLsp,
  lspRangeToMonaco,
  type MonacoPositionLike,
  type MonacoRangeLike,
};

interface MonacoTypeScriptDefaults {
  modeConfiguration: {
    definitions?: boolean;
    implementations?: boolean;
    [key: string]: unknown;
  };
  setModeConfiguration(config: {
    definitions?: boolean;
    implementations?: boolean;
    [key: string]: unknown;
  }): void;
}

interface MonacoTypeScriptContribution {
  typescriptDefaults?: MonacoTypeScriptDefaults;
  javascriptDefaults?: MonacoTypeScriptDefaults;
  getTypeScriptWorker?: () => Promise<
    (uri: monaco.Uri) => Promise<{
      getDefinitionAtPosition: (
        fileName: string,
        position: number,
      ) => Promise<
        | Array<{
            fileName: string;
            textSpan: { start: number; length: number };
          }>
        | undefined
      >;
      getImplementationAtPosition?: (
        fileName: string,
        position: number,
      ) => Promise<
        | Array<{
            fileName: string;
            textSpan: { start: number; length: number };
          }>
        | undefined
      >;
    }>
  >;
  getJavaScriptWorker?: () => Promise<
    (uri: monaco.Uri) => Promise<{
      getDefinitionAtPosition: (
        fileName: string,
        position: number,
      ) => Promise<
        | Array<{
            fileName: string;
            textSpan: { start: number; length: number };
          }>
        | undefined
      >;
      getImplementationAtPosition?: (
        fileName: string,
        position: number,
      ) => Promise<
        | Array<{
            fileName: string;
            textSpan: { start: number; length: number };
          }>
        | undefined
      >;
    }>
  >;
}

function getMonacoTypeScriptContribution(): MonacoTypeScriptContribution | null {
  const langs = monaco.languages as Record<string, unknown>;
  if (
    "typescript" in langs &&
    typeof langs.typescript === "object" &&
    langs.typescript !== null
  ) {
    return langs.typescript as MonacoTypeScriptContribution;
  }
  return null;
}
export interface SemanticMonacoManagerOptions {
  registry?: SemanticModelRegistry;
  getClientForModel?: (tabKey: string) => SemanticClient | null;
  onOpenCodeEditor?: (params: {
    tabKey: string;
    range?: monaco.IRange;
  }) => boolean;
}

export class SemanticMonacoManager {
  private definitionDisposables: monaco.IDisposable[] = [];
  private implementationDisposables: monaco.IDisposable[] = [];
  private openerDisposables: monaco.IDisposable[] = [];
  private active = false;
  private readonly registry: SemanticModelRegistry;
  constructor(private readonly options: SemanticMonacoManagerOptions = {}) {
    this.registry = options.registry ?? defaultSemanticModelRegistry;
  }

  setOptions(newOptions: Partial<SemanticMonacoManagerOptions>): void {
    Object.assign(this.options, newOptions);
    if (
      useSemanticNavigationStore.getState().globalSemanticEnabled &&
      !this.active
    ) {
      this.activate();
    }
  }

  /**
   * Activate the delegating Monaco Definition and Implementation providers.
   */
  activate(): void {
    if (this.active) return;
    this.active = true;

    // Suppress built-in definition/implementation in Monaco's worker so our
    // delegating provider is the single authoritative source.
    const tsContrib = getMonacoTypeScriptContribution();
    if (tsContrib?.typescriptDefaults) {
      tsContrib.typescriptDefaults.setModeConfiguration({
        ...tsContrib.typescriptDefaults.modeConfiguration,
        definitions: false,
        implementations: false,
      });
    }
    if (tsContrib?.javascriptDefaults) {
      tsContrib.javascriptDefaults.setModeConfiguration({
        ...tsContrib.javascriptDefaults.modeConfiguration,
        definitions: false,
        implementations: false,
      });
    }

    const languages = ["typescript", "javascript"];

    for (const lang of languages) {
      const defDisp = monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model, position, token) => {
          return this.provideDefinition(model, position, token);
        },
      });
      this.definitionDisposables.push(defDisp);

      const impDisp = monaco.languages.registerImplementationProvider(lang, {
        provideImplementation: async (model, position, token) => {
          return this.provideImplementation(model, position, token);
        },
      });
      this.implementationDisposables.push(impDisp);
    }

    const openerDisp = monaco.editor.registerEditorOpener({
      openCodeEditor: (source, resource, selectionOrPosition) => {
        return this.handleOpenCodeEditor(source, resource, selectionOrPosition);
      },
    });
    this.openerDisposables.push(openerDisp);
  }

  /**
   * Deactivate and restore default Monaco mode configuration.
   */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    for (const d of this.definitionDisposables) d.dispose();
    for (const d of this.implementationDisposables) d.dispose();
    for (const d of this.openerDisposables) d.dispose();
    this.definitionDisposables = [];
    this.implementationDisposables = [];
    this.openerDisposables = [];
    // Restore built-in provider configuration
    const tsContrib = getMonacoTypeScriptContribution();
    if (tsContrib?.typescriptDefaults) {
      tsContrib.typescriptDefaults.setModeConfiguration({
        ...tsContrib.typescriptDefaults.modeConfiguration,
        definitions: true,
        implementations: true,
      });
    }
    if (tsContrib?.javascriptDefaults) {
      tsContrib.javascriptDefaults.setModeConfiguration({
        ...tsContrib.javascriptDefaults.modeConfiguration,
        definitions: true,
        implementations: true,
      });
    }
  }

  private async provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.IPosition,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Definition | null> {
    const registered = this.registry.getByLocalModelUri(model.uri.toString());

    if (registered && registered.wireBinding) {
      const client = this.options.getClientForModel?.(
        registered.identity.tabKey,
      );
      if (client && client.getStatus() === "ready") {
        const lspPos = monacoPositionToLsp(position);
        const result = await client.getDefinition(
          registered.identity.tabKey,
          lspPos,
          token,
        );

        if (result.outsideTarget || result.locations.length === 0) {
          return null;
        }

        return this.mapLocationsToMonaco(
          result.locations,
          registered.wireBinding.targetId,
          registered,
        );
      }
    }

    // Fallback: Delegate to Monaco built-in worker for non-semantic or unattached models
    return this.fallbackBuiltinDefinition(model, position);
  }

  private async provideImplementation(
    model: monaco.editor.ITextModel,
    position: monaco.IPosition,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Definition | null> {
    const registered = this.registry.getByLocalModelUri(model.uri.toString());

    if (registered && registered.wireBinding) {
      const client = this.options.getClientForModel?.(
        registered.identity.tabKey,
      );
      if (client && client.getStatus() === "ready") {
        const lspPos = monacoPositionToLsp(position);
        const result = await client.getImplementation(
          registered.identity.tabKey,
          lspPos,
          token,
        );

        if (result.outsideTarget || result.locations.length === 0) {
          return null;
        }

        return this.mapLocationsToMonaco(
          result.locations,
          registered.wireBinding.targetId,
          registered,
        );
      }
    }

    return this.fallbackBuiltinImplementation(model, position);
  }

  private mapLocationsToMonaco(
    locations: SemanticLocation[],
    targetId: string,
    registeredModel: RegisteredModel,
  ): monaco.languages.Location[] {
    const monacoLocations: monaco.languages.Location[] = [];

    for (const loc of locations) {
      const parsed = parseSemanticWireUri(loc.uri, targetId);
      if (!parsed) continue;

      const destModel = this.registry.getByWireUri(loc.uri);
      let targetUri: monaco.Uri;

      if (destModel) {
        targetUri = monaco.Uri.parse(destModel.identity.localModelUri);
      } else {
        const targetInput: ProjectTargetInput = {
          project: registeredModel.identity.project,
          profileId: registeredModel.identity.profileId,
        };
        const simulatedTabKey = editorFileTabKey(
          targetInput,
          parsed.relativePath,
        );
        targetUri = monaco.Uri.parse(buildLocalModelUri(simulatedTabKey));
      }

      const monacoRange = lspRangeToMonaco(loc.range);
      monacoLocations.push({
        uri: targetUri,
        range: monacoRange,
      });
    }

    return monacoLocations;
  }

  private handleOpenCodeEditor(
    _source: monaco.editor.ICodeEditor,
    resource: monaco.Uri,
    selectionOrPosition?: monaco.IRange | monaco.IPosition,
  ): boolean {
    if (resource.scheme !== "inmemory") return false;
    const uriStr = resource.toString();
    const prefix = "inmemory://dam-hopper/";
    if (!uriStr.startsWith(prefix)) return false;

    const encodedTabKey = uriStr.slice(prefix.length);
    const tabKey = decodeURIComponent(encodedTabKey);

    let range: monaco.IRange | undefined;
    if (selectionOrPosition && "startLineNumber" in selectionOrPosition) {
      range = selectionOrPosition;
    } else if (selectionOrPosition && "lineNumber" in selectionOrPosition) {
      range = {
        startLineNumber: selectionOrPosition.lineNumber,
        startColumn: selectionOrPosition.column,
        endLineNumber: selectionOrPosition.lineNumber,
        endColumn: selectionOrPosition.column,
      };
    }

    return this.options.onOpenCodeEditor?.({ tabKey, range }) ?? false;
  }

  private async fallbackBuiltinImplementation(
    model: monaco.editor.ITextModel,
    position: monaco.IPosition,
  ): Promise<monaco.languages.Definition | null> {
    try {
      const isJs = model.getLanguageId() === "javascript";
      const tsContrib = getMonacoTypeScriptContribution();
      const getWorker = isJs
        ? tsContrib?.getJavaScriptWorker
        : tsContrib?.getTypeScriptWorker;

      if (!getWorker) return null;

      const worker = await getWorker();
      const client = await worker(model.uri);
      if (!client.getImplementationAtPosition) return null;

      const offset = model.getOffsetAt(position);
      const defs = await client.getImplementationAtPosition(
        model.uri.toString(),
        offset,
      );
      if (!defs || defs.length === 0) return null;

      const results: monaco.languages.Location[] = [];
      for (const def of defs) {
        const defModel = monaco.editor.getModel(monaco.Uri.parse(def.fileName));
        const startPos = defModel
          ? defModel.getPositionAt(def.textSpan.start)
          : { lineNumber: 1, column: 1 };
        const endPos = defModel
          ? defModel.getPositionAt(def.textSpan.start + def.textSpan.length)
          : startPos;

        results.push({
          uri: monaco.Uri.parse(def.fileName),
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          },
        });
      }

      return results;
    } catch {
      return null;
    }
  }

  private async fallbackBuiltinDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.IPosition,
  ): Promise<monaco.languages.Definition | null> {
    try {
      const isJs = model.getLanguageId() === "javascript";
      const tsContrib = getMonacoTypeScriptContribution();
      const getWorker = isJs
        ? tsContrib?.getJavaScriptWorker
        : tsContrib?.getTypeScriptWorker;

      if (!getWorker) return null;

      const worker = await getWorker();
      const client = await worker(model.uri);
      const offset = model.getOffsetAt(position);
      const defs = await client.getDefinitionAtPosition(
        model.uri.toString(),
        offset,
      );

      if (!defs || defs.length === 0) return null;

      const results: monaco.languages.Location[] = [];
      for (const def of defs) {
        const defModel = monaco.editor.getModel(monaco.Uri.parse(def.fileName));
        const startPos = defModel
          ? defModel.getPositionAt(def.textSpan.start)
          : { lineNumber: 1, column: 1 };
        const endPos = defModel
          ? defModel.getPositionAt(def.textSpan.start + def.textSpan.length)
          : startPos;

        results.push({
          uri: monaco.Uri.parse(def.fileName),
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          },
        });
      }

      return results;
    } catch {
      return null;
    }
  }
}

/** Global singleton instance */
export const defaultSemanticMonacoManager = new SemanticMonacoManager();

registerSemanticToggleListener((enabled) => {
  if (enabled) {
    defaultSemanticMonacoManager.activate();
  } else {
    defaultSemanticMonacoManager.deactivate();
  }
});

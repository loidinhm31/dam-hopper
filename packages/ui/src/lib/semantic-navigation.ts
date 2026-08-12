import {
  MAX_SEMANTIC_TARGETS,
  parseSemanticProtocolTargets,
  type SemanticNavigationTarget,
  type SemanticOperation,
  type SemanticLanguage,
} from "@dam-hopper/shared";
import type * as monaco from "monaco-editor";
import { useNavigationResultsStore } from "@/stores/navigation-results.js";

export interface SemanticProviderBridge {
  isAvailable?: (language: SemanticLanguage) => boolean;
  navigate: (request: {
    requestId: string;
    operation: SemanticOperation;
    language: SemanticLanguage;
    path: string;
    line: number;
    character: number;
    documentVersion: number;
    signal: monaco.CancellationToken;
  }) => Promise<SemanticNavigationTarget[] | null>;
}

export function createSemanticProviders(
  api: typeof monaco,
  language: string,
  bridge: SemanticProviderBridge,
  document: (
    model: monaco.editor.ITextModel,
  ) => { language: SemanticLanguage; path: string; version: number } | null,
  editor?: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable {
  const disposables: monaco.IDisposable[] = [
    api.languages.registerDefinitionProvider(
      language,
      provider("definition", bridge, document),
    ),
    api.languages.registerImplementationProvider(
      language,
      provider("implementation", bridge, document),
    ),
    api.languages.registerReferenceProvider(language, {
      provideReferences: (model, position, _context, token) =>
        provide("references", model, position, token, bridge, document),
    }),
  ];
  if (editor) {
    disposables.push(
      ...registerSemanticEditorActions(api, editor, bridge, document),
    );
    disposables.push(
      registerSemanticModifierClick(api, editor, bridge, document),
    );
  }
  return { dispose: () => disposables.forEach((item) => item.dispose()) };
}

export function applyNavigationTargets(
  operation: SemanticOperation,
  targets: unknown,
  requestKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
): void {
  if (!Array.isArray(targets) || targets.length === 0) {
    useNavigationResultsStore
      .getState()
      .set({ kind: "empty", operation }, requestKey);
    return;
  }
  const parsed = parseSemanticProtocolTargets(
    targets.slice(0, MAX_SEMANTIC_TARGETS),
  );
  if (parsed.length === 0) {
    useNavigationResultsStore
      .getState()
      .set({ kind: "empty", operation }, requestKey);
    return;
  }
  useNavigationResultsStore.getState().set(
    {
      kind: "targets",
      targets: parsed,
      capped: targets.length > MAX_SEMANTIC_TARGETS,
      operation,
    },
    requestKey,
  );
}

function registerSemanticEditorActions(
  api: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  bridge: SemanticProviderBridge,
  document: (
    model: monaco.editor.ITextModel,
  ) => { language: SemanticLanguage; path: string; version: number } | null,
): monaco.IDisposable[] {
  const run = (operation: SemanticOperation) => {
    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) return;
    void provide(
      operation,
      model,
      position,
      {
        isCancellationRequested: false,
      } as monaco.CancellationToken,
      bridge,
      document,
    );
  };
  const actions = [
    ["semantic.goToDefinition", "Go to Definition", "F12", "definition"],
    [
      "semantic.goToImplementation",
      "Go to Implementation",
      "CtrlCmd+F12",
      "implementation",
    ],
    ["semantic.findReferences", "Find References", "Shift+F12", "references"],
  ] as const;
  return actions.map(([id, label, keybinding, operation]) =>
    editor.addAction({
      id,
      label,
      keybindings:
        keybinding === "F12"
          ? [api.KeyCode.F12]
          : keybinding === "CtrlCmd+F12"
            ? [api.KeyMod.CtrlCmd | api.KeyCode.F12]
            : [api.KeyMod.Shift | api.KeyCode.F12],
      contextMenuGroupId: "navigation",
      contextMenuOrder: keybinding === "F12" ? 1 : 2,
      run: () => run(operation),
    }),
  );
}

function registerSemanticModifierClick(
  api: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  bridge: SemanticProviderBridge,
  document: (
    model: monaco.editor.ITextModel,
  ) => { language: SemanticLanguage; path: string; version: number } | null,
): monaco.IDisposable {
  return editor.onMouseDown((event) => {
    if (
      !event.event.leftButton ||
      (!event.event.ctrlKey && !event.event.metaKey) ||
      event.target.type !== api.editor.MouseTargetType.CONTENT_TEXT ||
      !event.target.position
    )
      return;
    const model = editor.getModel();
    if (!model) return;
    event.event.preventDefault();
    event.event.stopPropagation();
    void provide(
      "definition",
      model,
      event.target.position,
      { isCancellationRequested: false } as monaco.CancellationToken,
      bridge,
      document,
    );
  });
}

function provider(
  operation: SemanticOperation,
  bridge: SemanticProviderBridge,
  document: (
    model: monaco.editor.ITextModel,
  ) => { language: SemanticLanguage; path: string; version: number } | null,
) {
  return {
    provideDefinition: (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      token: monaco.CancellationToken,
    ) => provide(operation, model, position, token, bridge, document),
    provideImplementation: (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      token: monaco.CancellationToken,
    ) => provide(operation, model, position, token, bridge, document),
  };
}

async function provide(
  operation: SemanticOperation,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken,
  bridge: SemanticProviderBridge,
  document: (
    model: monaco.editor.ITextModel,
  ) => { language: SemanticLanguage; path: string; version: number } | null,
): Promise<null> {
  const identity = document(model);
  if (
    !identity ||
    (bridge.isAvailable && !bridge.isAvailable(identity.language)) ||
    token.isCancellationRequested
  )
    return null;
  const requestKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  useNavigationResultsStore
    .getState()
    .set({ kind: "loading", requestId: requestKey, operation }, requestKey);
  try {
    if (token.isCancellationRequested) {
      useNavigationResultsStore.getState().clearRequest(requestKey);
      return null;
    }
    const targets = await bridge.navigate({
      requestId: requestKey,
      operation,
      ...identity,
      line: position.lineNumber - 1,
      character: position.column - 1,
      documentVersion: identity.version,
      signal: token,
    });
    if (token.isCancellationRequested) {
      useNavigationResultsStore.getState().clearRequest(requestKey);
      return null;
    }
    applyNavigationTargets(operation, targets, requestKey);
  } catch {
    useNavigationResultsStore
      .getState()
      .set({ kind: "empty", operation }, requestKey);
  }
  return null;
}

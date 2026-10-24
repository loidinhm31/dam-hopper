/** Model-scoped semantic navigation. Never changes Monaco's global TS/JS defaults. */
import * as monaco from "monaco-editor";
import type { SemanticClient, SemanticLocation } from "@/api/semantic-client.js";
import {
  type SemanticModelRegistry,
  type RegisteredModel,
  defaultSemanticModelRegistry,
  parseSemanticWireUri,
  buildLocalModelUri,
  monacoPositionToLsp,
  lspRangeToMonaco,
  computeUtf8Sha256HexSync,
} from "./semantic-model-uri.js";
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import type { ProjectTargetRef } from "@/api/client.js";
import { registerSemanticToggleListener, useSemanticNavigationStore } from "@/stores/semantic-navigation.js";

export { monacoPositionToLsp, lspRangeToMonaco, type MonacoPositionLike, type MonacoRangeLike } from "./semantic-model-uri.js";

export interface SemanticMonacoRegistration {
  getClientForModel: (tabKey: string) => SemanticClient | null;
}
export interface SemanticMonacoManagerOptions {
  registry?: SemanticModelRegistry;
  getClientForModel?: SemanticMonacoRegistration["getClientForModel"];
}

export interface SemanticDestination {
  tabKey: string;
  target: ProjectTargetRef;
  relativePath: string;
}

/** One resolver for existing AND unopened destinations; no tab-key decoding or pane fallback. */
export function resolveSemanticDestination(
  source: RegisteredModel,
  relativePath: string,
  tabs: readonly Tab[],
): SemanticDestination | null {
  const sourceTab = tabs.find((tab) => tab.key === source.identity.tabKey);
  if (!sourceTab?.target.profileId || !sourceTab.targetAvailable ||
      sourceTab.project !== source.identity.project ||
      sourceTab.target.profileId !== source.identity.profileId ||
      sourceTab.targetKey !== source.identity.targetKey) return null;
  const target = sourceTab.target;
  return { tabKey: editorFileTabKey(target, relativePath), target, relativePath };
}

type Destination = SemanticDestination & {
  source: RegisteredModel;
  binding: NonNullable<RegisteredModel["wireBinding"]>;
  client: SemanticClient;
  location: SemanticLocation;
  isCurrent: () => boolean;
  createdAt: number;
  isDestinationCurrent: () => boolean;
  wasOpen: boolean;
};

export class SemanticMonacoManager {
  private active = false;
  private readonly registry: SemanticModelRegistry;
  private readonly registrations = new Map<symbol, SemanticMonacoRegistration>();
  private readonly providers = new Map<string, monaco.IDisposable[]>();
  private readonly destinations = new Map<string, Destination>();
  private readonly requestEpochs = new Map<string, number>();
  private nextRequestEpoch = 0;
  private revealEpoch = 0;
  private lifecycle: Array<monaco.IDisposable | (() => void)> = [];

  constructor(options: SemanticMonacoManagerOptions = {}) {
    this.registry = options.registry ?? defaultSemanticModelRegistry;
    if (options.getClientForModel) this.register({ getClientForModel: options.getClientForModel });
  }

  /** Every mount owns a distinct token, even when two panes share a client/scope. */
  register(options: SemanticMonacoRegistration): monaco.IDisposable {
    const token = Symbol("semantic-monaco-registration");
    this.registrations.set(token, options);
    if (useSemanticNavigationStore.getState().globalSemanticEnabled) this.activate();
    this.refresh();
    return { dispose: () => { this.registrations.delete(token); this.refresh(); } };
  }

  private clientFor(model: RegisteredModel): SemanticClient | null {
    if (useEditorStore.getState().tabs.some((tab) => tab.key === model.identity.tabKey && !tab.targetAvailable)) return null;
    for (const registration of this.registrations.values()) {
      const client = registration.getClientForModel(model.identity.tabKey);
      if (client?.getStatus() === "ready" && client.canAccessModel(model.identity.tabKey)) return client;
    }
    return null;
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle = [
      this.registry.subscribe(() => this.refresh()),
      useSemanticNavigationStore.subscribe((state, previous) => {
        if (state.clientStatuses !== previous.clientStatuses || state.profileSemanticEnabled !== previous.profileSemanticEnabled ||
            state.globalSemanticEnabled !== previous.globalSemanticEnabled) this.refresh();
      }),
      useEditorStore.subscribe((state, previous) => {
        if (state.tabs.length !== previous.tabs.length || state.tabs.some((tab, index) =>
          tab.key !== previous.tabs[index]?.key || tab.targetAvailable !== previous.tabs[index]?.targetAvailable ||
          tab.semanticProvenance !== previous.tabs[index]?.semanticProvenance)) this.refresh();
      }),
      monaco.editor.onDidCreateModel(() => this.refresh()),
      monaco.editor.onWillDisposeModel(() => queueMicrotask(() => this.refresh())),
      monaco.editor.registerEditorOpener({
        openCodeEditor: (source, resource, selection) => this.openDestination(source, resource, selection),
      }),
    ];
    this.refresh();
  }

  deactivate(): void {
    this.active = false;
    for (const cleanup of this.lifecycle) typeof cleanup === "function" ? cleanup() : cleanup.dispose();
    this.lifecycle = [];
    for (const providers of this.providers.values()) for (const provider of providers) provider.dispose();
    this.providers.clear();
    this.destinations.clear();
    this.requestEpochs.clear();
    this.revealEpoch++;
  }

  private refresh(): void {
    if (!this.active) return;
    for (const key of this.requestEpochs.keys()) if (!this.registry.getByTabKey(key)) this.requestEpochs.delete(key);
    for (const [key, destination] of this.destinations) if (!destination.isCurrent()) this.destinations.delete(key);
    const eligible = new Set<string>();
    for (const registered of this.registry.getAllRegistered()) {
      if (!registered.wireBinding || !this.clientFor(registered)) continue;
      const uri = monaco.Uri.parse(registered.identity.localModelUri);
      const language = registered.wireBinding.languageDescriptor;
      // Monaco selectors compare fsPath, not authority. Do not suppress an unrelated
      // model whose authority happens to share the same selector path.
      if (monaco.editor.getModels().some((model) => model.uri.scheme === uri.scheme &&
          model.uri.fsPath === uri.fsPath && model.uri.toString() !== uri.toString())) continue;
      eligible.add(registered.identity.tabKey);
      if (this.providers.has(registered.identity.tabKey)) continue;
      const literalPath = uri.fsPath.replace(/[\[\]*?{}]/g, (character) => `[${character}]`);
      const selector = { language, scheme: uri.scheme, pattern: literalPath, exclusive: true };
      this.providers.set(registered.identity.tabKey, [
        monaco.languages.registerDefinitionProvider(selector, {
          provideDefinition: (model, position, token) => {
            const current = this.registry.getByTabKey(registered.identity.tabKey);
            return current ? this.navigate("definition", current, model, position, token) : null;
          },
        }),
        monaco.languages.registerImplementationProvider(selector, {
          provideImplementation: (model, position, token) => {
            const current = this.registry.getByTabKey(registered.identity.tabKey);
            return current ? this.navigate("implementation", current, model, position, token) : null;
          },
        }),
      ]);
    }
    for (const [key, providers] of this.providers) {
      if (!eligible.has(key)) { for (const provider of providers) provider.dispose(); this.providers.delete(key); }
    }
  }

  private async navigate(
    kind: "definition" | "implementation",
    registered: RegisteredModel,
    model: monaco.editor.ITextModel,
    position: monaco.IPosition,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[] | null> {
    const binding = registered.wireBinding;
    const client = this.clientFor(registered);
    if (!this.active || !binding || !client || token.isCancellationRequested ||
        model.uri.toString() !== monaco.Uri.parse(registered.identity.localModelUri).toString()) return null;
    const version = model.getVersionId();
    const requestEpoch = ++this.nextRequestEpoch;
    this.requestEpochs.set(registered.identity.tabKey, requestEpoch);
    const isCurrent = () => this.active && !token.isCancellationRequested && !model.isDisposed() &&
      model.getVersionId() === version && registered.wireBinding === binding &&
      this.registry.getByTabKey(registered.identity.tabKey) === registered &&
      this.requestEpochs.get(registered.identity.tabKey) === requestEpoch && this.clientFor(registered) === client;
    const result = await (kind === "definition" ? client.getDefinition.bind(client) : client.getImplementation.bind(client))(
      registered.identity.tabKey, monacoPositionToLsp(position), token,
    );
    if (!isCurrent() || result.outsideTarget) return null;
    for (const [key, destination] of this.destinations) {
      if (destination.source.identity.tabKey === registered.identity.tabKey) this.destinations.delete(key);
    }
    const candidates: Array<{ location: monaco.languages.Location; destination: Destination }> = [];
    for (const location of result.locations) {
      if (!/^[a-f0-9]{64}$/.test(location.damHopperDestinationContentSha256 ?? "")) continue;
      const parsed = parseSemanticWireUri(location.uri, binding.targetId);
      if (!parsed) continue;
      const destination = resolveSemanticDestination(registered, parsed.relativePath, useEditorStore.getState().tabs);
      if (!destination) continue;
      const uri = monaco.Uri.parse(buildLocalModelUri(destination.tabKey));
      const destinationModel = monaco.editor.getModel(uri);
      let isDestinationCurrent = () => !monaco.editor.getModel(uri);
      if (destinationModel) {
        const destinationRegistered = this.registry.getByTabKey(destination.tabKey);
        if (!destinationRegistered || !client.canAccessModel(destination.tabKey)) continue;
        const destinationVersion = destinationModel.getVersionId();
        const destinationBinding = destinationRegistered.wireBinding;
        const wireVersion = destinationBinding?.wireVersion;
        isDestinationCurrent = () => !destinationModel.isDisposed() &&
          destinationModel.getVersionId() === destinationVersion &&
          this.registry.getByTabKey(destination.tabKey) === destinationRegistered &&
          destinationRegistered.wireBinding === destinationBinding && destinationBinding?.wireVersion === wireVersion &&
          client.canAccessModel(destination.tabKey);
        if (!await client.validateDestination(location, destination.tabKey, destinationModel.getValue()) ||
            !isDestinationCurrent() || !isCurrent()) continue;
      }
      const range = lspRangeToMonaco(location.range);
      candidates.push({ location: { uri, range }, destination: { ...destination, source: registered, binding, client, location,
        isCurrent, isDestinationCurrent, wasOpen: !!destinationModel, createdAt: Date.now() } });
    }
    if (!isCurrent()) return null;
    const locations: monaco.languages.Location[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.destination.isDestinationCurrent()) continue;
      const key = JSON.stringify([registered.identity.tabKey, candidate.location.uri.toString(), candidate.location.range]);
      if (seen.has(key)) continue;
      seen.add(key);
      this.destinations.set(key, candidate.destination);
      locations.push(candidate.location);
    }
    return locations;
  }

  private async openDestination(source: monaco.editor.ICodeEditor, resource: monaco.Uri, selection?: monaco.IRange | monaco.IPosition): Promise<boolean> {
    const matches = [...this.destinations.values()].filter((candidate) => {
      if (source.getModel()?.uri.toString() !== monaco.Uri.parse(candidate.source.identity.localModelUri).toString()) return false;
      if (monaco.Uri.parse(buildLocalModelUri(candidate.tabKey)).toString() !== resource.toString()) return false;
      const range = lspRangeToMonaco(candidate.location.range);
      return selection && ("startLineNumber" in selection
        ? monaco.Range.equalsRange(range, selection) ||
          (selection.startLineNumber === range.startLineNumber && selection.startColumn === range.startColumn &&
            selection.endLineNumber === range.startLineNumber && selection.endColumn === range.startColumn)
        : range.startLineNumber === selection.lineNumber && range.startColumn === selection.column);
    });
    if (matches.length === 0) {
      // A retired semantic result must not fall through to Monaco's ambient opener.
      // Unowned sources and resources outside our model namespace remain untouched.
      const sourceUri = source.getModel()?.uri.toString();
      const registered = sourceUri ? this.registry.getByLocalModelUri(sourceUri) : undefined;
      return this.active && !!registered?.wireBinding && resource.scheme === "inmemory" &&
        resource.authority === "dam-hopper";
    }
    if (matches.some((candidate) => candidate.tabKey !== matches[0].tabKey ||
        candidate.location.damHopperDestinationContentSha256 !== matches[0].location.damHopperDestinationContentSha256 ||
        candidate.location.damHopperDestinationVersion !== matches[0].location.damHopperDestinationVersion ||
        candidate.location.damHopperDestinationIncarnation !== matches[0].location.damHopperDestinationIncarnation)) return true;
    const destination = matches[0];
    if (!destination.isCurrent() || !destination.isDestinationCurrent() || Date.now() - destination.createdAt > 10_000) return true;
    const currentModel = source.getModel();
    if (currentModel?.uri.toString() === resource.toString()) {
      // Native navigation collapses its opener selection to the range start.
      // Revalidate and reveal this already-open exact model synchronously.
      if (!destination.client.canAccessModel(destination.tabKey) ||
          computeUtf8Sha256HexSync(currentModel.getValue()) !== destination.location.damHopperDestinationContentSha256 ||
          !destination.isCurrent() || !destination.isDestinationCurrent()) return true;
      const range = lspRangeToMonaco(destination.location.range);
      source.setSelection(range);
      source.revealRangeInCenter(range);
      return true;
    }
    const revealEpoch = ++this.revealEpoch;
    const range = selection && "lineNumber" in selection
      ? { startLineNumber: selection.lineNumber, startColumn: selection.column, endLineNumber: selection.lineNumber, endColumn: selection.column }
      : lspRangeToMonaco(destination.location.range);
    const node = { id: destination.relativePath, name: destination.relativePath.split("/").pop()!, kind: "file" as const,
      size: 0, mtime: 0, isSymlink: false, children: null };
    try {
      await useEditorStore.getState().open(destination.target, node);
    } catch {
      return true; // Claimed semantic URI; never fall through to an ambient opener.
    }
    const tab = useEditorStore.getState().tabs.find((tab) => tab.key === destination.tabKey);
    if (!tab || !tab.targetAvailable || tab.loading || tab.error) return true;
    const isCurrent = () => revealEpoch === this.revealEpoch && destination.isCurrent() &&
      (!destination.wasOpen || destination.isDestinationCurrent());
    if (!isCurrent()) return true;
    useSemanticNavigationStore.getState().setRevealIntent({
      targetId: destination.binding.targetId,
      profileId: destination.target.profileId!, project: destination.target.project,
      targetKey: destination.source.identity.targetKey, relativePath: destination.relativePath,
      range, createdAt: Date.now(),
      destinationContentSha256: destination.location.damHopperDestinationContentSha256,
      destinationVersion: destination.location.damHopperDestinationVersion,
      destinationIncarnation: destination.location.damHopperDestinationIncarnation,
      isCurrent,
    });
    return true;
  }
}

export const defaultSemanticMonacoManager = new SemanticMonacoManager();
registerSemanticToggleListener((enabled) => {
  if (enabled) defaultSemanticMonacoManager.activate();
  else defaultSemanticMonacoManager.deactivate();
});

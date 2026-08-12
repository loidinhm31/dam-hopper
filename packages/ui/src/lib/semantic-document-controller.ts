import type { SemanticLanguage, SemanticUri } from "@dam-hopper/shared";
import type { SemanticTransport } from "@/api/semantic-transport.js";

export interface SemanticDocumentInput {
  profileId: string;
  projectId: string;
  path: string;
  language: SemanticLanguage;
  text: string;
  hydrated?: boolean;
}

interface DocumentState {
  uri: SemanticUri;
  text: string;
  sentText: string | null;
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Keeps editor snapshots monotonic and bounds change traffic to 50 ms. */
export class SemanticDocumentController {
  private readonly documents = new Map<string, DocumentState>();
  private readonly lastVersions = new Map<string, number>();

  constructor(private readonly transport: SemanticTransport) {}

  sync(inputs: readonly SemanticDocumentInput[]): void {
    const nextKeys = new Set<string>();
    for (const input of inputs) {
      const uri = safeUri(input);
      if (!uri) continue;
      const key = semanticDocumentKey(uri);
      if (!input.hydrated || typeof input.text !== "string") continue;
      nextKeys.add(key);
      const current = this.documents.get(key);
      if (!current) {
        const version = this.lastVersions.get(key) ?? 0;
        const state: DocumentState = {
          uri,
          text: input.text,
          sentText: null,
          version,
          timer: null,
        };
        this.documents.set(key, state);
        this.sendOpen(state);
      } else if (current.text !== input.text) {
        current.text = input.text;
        current.version = Math.max(
          current.version + 1,
          (this.lastVersions.get(key) ?? 0) + 1,
        );
        this.lastVersions.set(key, current.version);
        this.scheduleChange(key, current);
      }
    }

    for (const [key, state] of this.documents) {
      if (nextKeys.has(key)) continue;
      this.flushState(state);
      this.transport.closeDocument({
        kind: "semantic:document_close",
        uri: state.uri,
        documentVersion: state.version,
      });
      this.clearTimer(state);
      this.documents.delete(key);
    }
  }

  flush(uri?: SemanticUri): void {
    if (uri) {
      const state = this.documents.get(semanticDocumentKey(uri));
      if (state) this.flushState(state);
      return;
    }
    this.documents.forEach((state) => this.flushState(state));
  }

  replay(projectId: string): void {
    for (const state of this.documents.values()) {
      if (state.uri.projectId !== projectId) continue;
      state.sentText = null;
      this.clearTimer(state);
      this.sendOpen(state);
    }
  }

  version(uri: SemanticUri): number | null {
    return this.documents.get(semanticDocumentKey(uri))?.version ?? null;
  }

  snapshots(projectId: string): SemanticDocumentInput[] {
    return [...this.documents.values()]
      .filter((state) => state.uri.projectId === projectId)
      .map((state) => ({ ...state.uri, text: state.text }));
  }

  dispose(): void {
    this.documents.forEach((state) => this.clearTimer(state));
    this.documents.clear();
  }

  private sendOpen(state: DocumentState): void {
    if (
      this.transport.openDocument({
        kind: "semantic:document_open",
        uri: state.uri,
        documentVersion: state.version,
        text: state.text,
      })
    ) {
      state.sentText = state.text;
    }
  }

  private scheduleChange(key: string, state: DocumentState): void {
    this.clearTimer(state);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (this.documents.get(key) === state) this.flushState(state);
    }, 50);
  }

  private flushState(state: DocumentState): void {
    this.clearTimer(state);
    if (state.sentText === state.text) return;
    if (
      this.transport.changeDocument({
        kind: "semantic:document_change",
        uri: state.uri,
        documentVersion: state.version,
        text: state.text,
      })
    ) {
      state.sentText = state.text;
    }
  }

  private clearTimer(state: DocumentState): void {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  }
}

export function semanticDocumentKey(uri: SemanticUri): string {
  return JSON.stringify([uri.profileId, uri.projectId, uri.path, uri.language]);
}

function safeUri(input: SemanticDocumentInput): SemanticUri | null {
  if (!input.path || input.path.includes("\\") || input.path.startsWith("/"))
    return null;
  if (
    input.path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  return {
    profileId: input.profileId,
    projectId: input.projectId,
    path: input.path,
    language: input.language,
  };
}

import type {
  SemanticDescriptorAvailability,
  SemanticNavigationCancellation,
  SemanticNavigationRequest,
  SemanticNavigationResponse,
  SemanticTrustState,
  SemanticUri,
} from "./semantic-protocol.js";

export const SEMANTIC_PROTOCOL_VERSION = 1;
export const MAX_SEMANTIC_WS_MESSAGE_BYTES = 8 * 1024 * 1024;
export const MAX_SEMANTIC_OPEN_DOCUMENTS = 256;

export type SemanticClientMessage =
  | { kind: "semantic:project"; profileId: string; projectId: string }
  | {
      kind: "semantic:prewarm";
      projectId: string;
      language: SemanticUri["language"];
      tabGeneration: number;
    }
  | {
      kind: "semantic:document_open";
      uri: SemanticUri;
      documentVersion: number;
      text: string;
    }
  | {
      kind: "semantic:document_change";
      uri: SemanticUri;
      documentVersion: number;
      text: string;
    }
  | {
      kind: "semantic:document_close";
      uri: SemanticUri;
      documentVersion: number;
    }
  | ({ kind: "semantic:navigate" } & SemanticNavigationRequest)
  | ({ kind: "semantic:cancel" } & SemanticNavigationCancellation)
  | { kind: "semantic:resync"; projectId: string };

export interface SemanticDocumentReplay {
  uri: SemanticUri;
  documentVersion: number;
}

export type SemanticTrustEventReason =
  | "transition"
  | "revoked"
  | "policyChanged";

export type SemanticCloseReason =
  | "clientDisconnected"
  | "workspaceChanged"
  | "projectRevoked"
  | "policyChanged"
  | "serverShutdown";

export type SemanticStatusState =
  | "starting"
  | "ready"
  | "indexing"
  | "restricted"
  | "crashed"
  | "unavailable";

export type SemanticTransportErrorCode =
  | "invalidMessage"
  | "unknownMessage"
  | "unknownProject"
  | "projectMismatch"
  | "profileMismatch"
  | "staleDocument"
  | "policyChanged"
  | "deadlineExceeded"
  | "unsupportedCapability"
  | "internalUnavailable"
  | "messageTooLarge";

export type SemanticServerMessage =
  | SemanticNavigationResponse
  | {
      kind: "semantic:handshake";
      protocolVersion: number;
      sessionEpoch: number;
      workspaceGeneration: number;
      availability: SemanticDescriptorAvailability[];
      trust: SemanticTrustState[];
    }
  | {
      kind: "semantic:project";
      projectId: string;
      workspaceGeneration: number;
      trust: SemanticTrustState;
      availability: SemanticDescriptorAvailability[];
    }
  | {
      kind: "semantic:document_accepted";
      uri: SemanticUri;
      documentVersion: number;
    }
  | {
      kind: "semantic:replay";
      projectId: string;
      documents: SemanticDocumentReplay[];
    }
  | {
      kind: "semantic:status";
      projectId: string;
      state: SemanticStatusState;
      policyRevision: number;
    }
  | {
      kind: "semantic:progress";
      requestId: string;
      documentVersion: number;
      policyRevision: number;
      state: SemanticStatusState;
    }
  | {
      kind: "semantic:trust_changed";
      projectId: string;
      trust: SemanticTrustState;
      reason: SemanticTrustEventReason;
    }
  | { kind: "semantic:workspace_changed"; reason: SemanticCloseReason }
  | { kind: "semantic:error"; code: SemanticTransportErrorCode }
  | { kind: "semantic:closed"; reason: SemanticCloseReason };

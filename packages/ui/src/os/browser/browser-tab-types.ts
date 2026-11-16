import type {
  BrowserSessionDto,
  CreateSessionRequest,
} from "@/api/browser-host-types.js";
import type { BrowserAuthNamespace } from "@/api/connections.js";

export const BROWSER_STATE_VERSION = 1 as const;
export const BROWSER_RECOVERY_VERSION = 1 as const;
export const MAX_BROWSER_METADATA_BYTES = 1_048_576;

export interface BrowserOwnerScope {
  readonly profileId: string;
  readonly endpoint: string;
  readonly principal: string;
  readonly namespace: BrowserAuthNamespace;
}

export interface BrowserNativeTargetKey {
  readonly endpoint: string;
  readonly principal: string;
  readonly namespace: BrowserAuthNamespace;
  readonly sessionId: string;
}

export interface BrowserTargetRuntimeIdentity {
  readonly browserIncarnation?: string;
  readonly profileEpoch?: string;
}

export type BrowserTabKind = "ordinary" | "popup";

export type BrowserTabPhase =
  | "new-tab"
  | "deferred"
  | "connecting"
  | "live"
  | "unavailable"
  | "capacity"
  | "creating"
  | "create-unknown"
  | "closing"
  | "close-unknown";

export interface BrowserTabDraft {
  readonly value: string;
  readonly dirty: boolean;
}

export interface BrowserCreateIntent {
  readonly operationId: string;
  readonly creationKey: string;
  readonly request: CreateSessionRequest;
}

export interface BrowserTabRuntime {
  readonly tabId: string;
  readonly kind: BrowserTabKind;
  readonly committedUrl?: string;
  readonly sessionId?: string;
  readonly title?: string;
  readonly phase: BrowserTabPhase;
  readonly draft: BrowserTabDraft;
  readonly actionSequence: number;
  readonly createIntent?: BrowserCreateIntent;
  readonly parentTabId?: string;
  readonly popupAdmissionId?: string;
  readonly snapshot?: BrowserSessionDto;
}

export interface BrowserWindowClosingState {
  readonly operationId: string;
  readonly status: "pending" | "unknown";
}

export interface BrowserWindowState {
  readonly browserStateVersion: typeof BROWSER_STATE_VERSION;
  readonly ownerScope?: BrowserOwnerScope;
  readonly tabs: readonly BrowserTabRuntime[];
  readonly activeTabId: string;
  readonly closing?: BrowserWindowClosingState;
  readonly restoreGroupId?: string;
}

export interface BrowserTabDisk {
  readonly tabId: string;
  readonly committedUrl?: string;
  readonly sessionId?: string;
}

export interface BrowserWindowDisk {
  readonly browserStateVersion: typeof BROWSER_STATE_VERSION;
  readonly ownerScope?: BrowserOwnerScope;
  readonly tabs: readonly BrowserTabDisk[];
  readonly activeTabId: string;
}

export interface BrowserPortableTabDisk {
  readonly tabId: string;
  readonly committedUrl?: string;
}

export interface BrowserPortableWindowDisk {
  readonly browserStateVersion: typeof BROWSER_STATE_VERSION;
  readonly tabs: readonly BrowserPortableTabDisk[];
  readonly activeTabId: string;
}

export interface RememberedBrowserGroup {
  readonly version: typeof BROWSER_RECOVERY_VERSION;
  readonly groupId: string;
  readonly ownerScope: BrowserOwnerScope;
  readonly addresses: readonly string[];
  readonly activeIndex: number;
}

export type BrowserRecoveryOperationKind =
  | "create"
  | "close-tab"
  | "close-window";

export interface BrowserRecoveryOperation {
  readonly operationId: string;
  readonly ownerScope: BrowserOwnerScope;
  readonly kind: BrowserRecoveryOperationKind;
  readonly groupId?: string;
  readonly windowId: string;
  readonly tabId?: string;
  readonly sessionId?: string;
  readonly status: "pending" | "unknown";
}

export interface BrowserRecoveryDisk {
  readonly version: typeof BROWSER_RECOVERY_VERSION;
  readonly groups: readonly RememberedBrowserGroup[];
  readonly addressSuppressedScopes: readonly BrowserOwnerScope[];
  readonly operations: readonly BrowserRecoveryOperation[];
}

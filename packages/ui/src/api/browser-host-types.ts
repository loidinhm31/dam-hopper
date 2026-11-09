/**
 * Browser Host API and Streaming Protocol Types.
 *
 * Implements typed DTOs for REST endpoints, BHJF binary frame parser,
 * media and control WebSocket protocols per architecture-contracts.md.
 */
// Wire protocol constants
export const BHJF_MAGIC = new Uint8Array([0x42, 0x48, 0x4a, 0x46]); // "BHJF"
export const BHJF_VERSION = 1;
export const BHJF_FLAGS_NONE = 0;
export const BHJF_PREFIX_LEN = 16;
export const MAX_JSON_HEADER_BYTES = 1024;
export const MAX_JPEG_PAYLOAD_BYTES = 2_097_152; // 2 MiB
export const MAX_FRAME_MESSAGE_BYTES =
  BHJF_PREFIX_LEN + MAX_JSON_HEADER_BYTES + MAX_JPEG_PAYLOAD_BYTES; // 2,098,192

export const MAX_IMAGE_WIDTH = 1920;
export const MAX_IMAGE_HEIGHT = 1080;
export const MAX_PIXELS = 2_073_600; // 1920 * 1080
export const MAX_VIEWPORT_CSS_WIDTH = 1920;
export const MAX_VIEWPORT_CSS_HEIGHT = 1080;

export const MEDIA_SUBPROTOCOL = "damhopper.browser.media.v1";
export const CONTROL_SUBPROTOCOL = "damhopper.browser.control.v1";
export const CDP_SUBPROTOCOL = "damhopper.browser.cdp.v1";
export const TICKET_SUBPROTOCOL_PREFIX = "damhopper.ticket.";

export const MAX_MEDIA_CONTROL_BYTES = 1024;
export const MAX_CONTROL_MESSAGE_BYTES = 16 * 1024;
export const MAX_FIND_QUERY_CHARS = 256;
export const MAX_SELECTED_TEXT_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// REST DTOs
// ---------------------------------------------------------------------------

export interface EffectiveBounds {
  maxImageWidth: number;
  maxImageHeight: number;
  maxPixels: number;
  maxViewportCssWidth: number;
  maxViewportCssHeight: number;
  maxJpegPayloadBytes: number;
  maxPendingCommands: number;
  commandTimeoutSecs: number;
  maxFrameMessageBytes: number;
  maxOutstandingPerViewer: number;
  minDeliveryIntervalMs: number;
}

export interface EngineQualificationSummary {
  status: string;
  engineName: string;
  executablePath: string;
  engineVersion?: string;
  qualifiedAtUnixMs: number;
}

export interface BrowserCapabilitiesResponse {
  available: boolean;
  reason?: string;
  protocolVersion: number;
  effectiveBounds: EffectiveBounds;
  engineQualification?: EngineQualificationSummary;
  profileEpoch: string;
  managedProfilePresent: boolean;
}

export type BrowserSessionStatus =
  | "starting"
  | "running"
  | "stopping"
  | "crashed"
  | "closed";

export interface TargetGeometry {
  cssWidth: number;
  cssHeight: number;
  offsetTop: number;
  scrollX: number;
  scrollY: number;
  pageScale: number;
  visualOffsetX: number;
  visualOffsetY: number;
  dpr: number;
}

export interface BrowserSessionDto {
  browserSessionId: string;
  browserIncarnation: string;
  profileEpoch: string;
  navigationRevision: string;
  viewportEpoch: string;
  url: string;
  title: string;
  status: BrowserSessionStatus;
  geometry: TargetGeometry;
  inputAvailable: boolean;
  unavailableReason?: string;
}

export interface CreateSessionRequest {
  creationKey: string;
  url: string;
  viewport: {
    width: number;
    height: number;
    dpr: number;
  };
}

export interface NavigateRequest {
  url: string;
  navigationRevision: number | string;
}

export interface HistoryRequest {
  direction: "back" | "forward";
  navigationRevision: number | string;
}

export interface ReloadRequest {
  navigationRevision: number | string;
}

export interface SetViewportRequest {
  leaseToken: string;
  viewportEpoch: number | string;
  width: number;
  height: number;
  dpr: number;
}

export interface AcquireControlRequest {
  viewerId: string;
  holderKind: "human" | "agent";
}

export interface AcquireControlResponse {
  leaseToken: string;
  expiresAtUnixMs: number;
}

export interface RenewControlRequest {
  leaseToken: string;
}

export interface RenewControlResponse {
  leaseToken: string;
  expiresAtUnixMs: number;
}

export interface ReleaseControlRequest {
  leaseToken: string;
}

export interface DialogResponseRequest {
  leaseToken: string;
  dialogId: string;
  accept: boolean;
  promptText?: string;
}

export interface FindRequest {
  leaseToken: string;
  query: string;
  forward: boolean;
}

export interface FindResponse {
  query: string;
  forward: boolean;
  matchCount: number;
  activeMatchOrdinal: number;
}

export type AttachmentPurpose = "media" | "control" | "agentCdp";

export interface IssueTicketRequest {
  purpose: AttachmentPurpose;
  browserSessionId?: string;
  viewerId?: string;
  subscriptionEpoch?: string;
  browserIncarnation: string;
  profileEpoch: number;
}

export interface IssueTicketResponse {
  ticket: string;
  expiresAtUnixMs: number;
}

export interface ProfileResetRequest {
  operationId: string;
  expectedProfileEpoch: number;
  confirmed: boolean;
}

export interface ProfileResetResponse {
  status: "completed" | "cleanupPending";
  profileEpoch: number;
}

// ---------------------------------------------------------------------------
// BHJF Binary Frame Protocol
// ---------------------------------------------------------------------------

export interface TargetFrameHeader {
  browserSessionId: string;
  browserIncarnation: string;
  profileEpoch: string;
  producerRun: string;
  viewportEpoch: string;
  frameSeq: string;
  width: number;
  height: number;
  captureTimeUnixMs: number;
  geometry: TargetGeometry;
  inputTrusted: boolean;
}

export interface ParsedFrame {
  header: TargetFrameHeader;
  jpegPayload: Uint8Array;
}

export type DiscardReason =
  | "replaced"
  | "obsolete"
  | "hidden"
  | "decodeFailed"
  | "ownerChanged";

export type MediaClientControl =
  | {
      kind: "frameAck";
      subscriptionEpoch: string;
      producerRun: string;
      viewportEpoch: string;
      frameSeq: string;
      reason?: string;
    }
  | {
      kind: "frameDiscarded";
      subscriptionEpoch: string;
      producerRun: string;
      viewportEpoch: string;
      frameSeq: string;
      reason?: DiscardReason;
    }
  | {
      kind: "pause";
      subscriptionEpoch: string;
    }
  | {
      kind: "heartbeat";
      subscriptionEpoch: string;
      visible: boolean;
    };

export type ServerControlEvent =
  | {
      kind: "dialogOpened";
      dialogId: string;
      message: string;
      dialogType: string;
    }
  | {
      kind: "dialogClosed";
      dialogId: string;
    }
  | {
      kind: "leaseRevoked";
      reason: string;
    }
  | {
      kind: "status";
      inputAvailable: boolean;
      unavailableReason?: string;
    }
  | {
      kind: "error";
      message: string;
    };

// ---------------------------------------------------------------------------
// Input Protocol
// ---------------------------------------------------------------------------

export type MouseButton =
  | "none"
  | "left"
  | "middle"
  | "right"
  | "back"
  | "forward";

export type InputEvent =
  | {
      kind: "pointerDown";
      button: MouseButton;
      u: number;
      v: number;
      modifiers: number;
    }
  | {
      kind: "pointerUp";
      button: MouseButton;
      u: number;
      v: number;
      modifiers: number;
    }
  | {
      kind: "pointerMove";
      u: number;
      v: number;
      modifiers: number;
    }
  | {
      kind: "pointerCancel";
    }
  | {
      kind: "wheel";
      u: number;
      v: number;
      deltaX: number;
      deltaY: number;
      delta_x: number;
      delta_y: number;
      modifiers: number;
    }
  | {
      kind: "keyDown";
      key: string;
      code: string;
      modifiers: number;
    }
  | {
      kind: "keyUp";
      key: string;
      code: string;
      modifiers: number;
    }
  | {
      kind: "insertText";
      text: string;
    };

export interface InputMessage {
  browserSessionId: string;
  browserIncarnation: string;
  profileEpoch: number;
  subscriptionEpoch: string;
  leaseToken: string;
  inputSeq: number;
  viewportEpoch: number;
  event: InputEvent;
}

// ---------------------------------------------------------------------------
// Client Errors
// ---------------------------------------------------------------------------

export class BrowserHostClientError extends Error {
  constructor(
    message: string,
    public readonly kind: string,
    public readonly status?: number,
    public readonly operationId?: string,
  ) {
    super(message);
    this.name = "BrowserHostClientError";
  }
}

export class FrameProtocolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(`Frame protocol error [${code}]: ${message}`);
    this.name = "FrameProtocolError";
  }
}

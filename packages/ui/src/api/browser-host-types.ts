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
export const MAX_CLIENT_DECODE_MS = 60_000;
export const MAX_HEARTBEAT_SAMPLE_MS = 60_000;
export const MAX_HEARTBEAT_FRAME_COUNT = 10_000;
export const MAX_MEDIA_CONTROL_REASON_BYTES = 64;
export const MAX_SUBSCRIPTION_EPOCH_BYTES = 128;
export const MAX_FIND_QUERY_CHARS = 256;
export const MAX_SELECTED_TEXT_BYTES = 64 * 1024;
export const AUDIO_SAMPLE_RATE = 24_000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_ENCODING_PCM16LE = "pcm16le";
export const MAX_AUDIO_CHUNK_SAMPLES = 2_400; // 100 ms @ 24 kHz
export const MAX_AUDIO_PCM_BYTES = MAX_AUDIO_CHUNK_SAMPLES * 2; // 4,800 bytes
export const MAX_AUDIO_BASE64_BYTES = 6_400;
export const MAX_AUDIO_MESSAGE_BYTES = 8_192; // 8 KiB

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
  | "initializing"
  | "running"
  | "closing"
  | "lost"
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
  popupBlocked?: boolean;
  activePopupSessionId?: string;
  parentSessionId?: string;
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

export interface HeartbeatTelemetry {
  sampleMs: number;
  decodedFrames: number;
  replacedFrames: number;
  decodeMsEwma?: number;
}

export type MediaClientControl =
  | {
      kind: "frameAck";
      subscriptionEpoch: string;
      producerRun: string;
      viewportEpoch: string;
      frameSeq: string;
      reason?: string;
      decodeMs?: number;
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
      telemetry?: HeartbeatTelemetry;
    };

const MEDIA_CONTROL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_CONTROL_SEQ_RE = /^[1-9][0-9]{0,19}$/;
const MEDIA_CONTROL_MAX_U64 = 18446744073709551615n;
const mediaControlTextEncoder = new TextEncoder();
const VALID_DISCARD_REASONS: Record<string, true> = {
  replaced: true,
  obsolete: true,
  hidden: true,
  decodeFailed: true,
  ownerChanged: true,
};

function isValidPositiveDecimalU64(val: unknown): val is string {
  if (typeof val !== "string" || !MEDIA_CONTROL_SEQ_RE.test(val)) return false;
  try {
    const n = BigInt(val);
    return n > 0n && n <= MEDIA_CONTROL_MAX_U64;
  } catch {
    return false;
  }
}

export function isValidHeartbeatTelemetry(
  val: unknown,
): val is HeartbeatTelemetry {
  if (!val || typeof val !== "object" || Array.isArray(val)) return false;
  const rec = val as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (
      key !== "sampleMs" &&
      key !== "decodedFrames" &&
      key !== "replacedFrames" &&
      key !== "decodeMsEwma"
    ) {
      return false;
    }
  }
  if (
    typeof rec.sampleMs !== "number" ||
    !Number.isInteger(rec.sampleMs) ||
    rec.sampleMs < 0 ||
    rec.sampleMs > MAX_HEARTBEAT_SAMPLE_MS
  ) {
    return false;
  }
  if (
    typeof rec.decodedFrames !== "number" ||
    !Number.isInteger(rec.decodedFrames) ||
    rec.decodedFrames < 0 ||
    rec.decodedFrames > MAX_HEARTBEAT_FRAME_COUNT
  ) {
    return false;
  }
  if (
    typeof rec.replacedFrames !== "number" ||
    !Number.isInteger(rec.replacedFrames) ||
    rec.replacedFrames < 0 ||
    rec.replacedFrames > MAX_HEARTBEAT_FRAME_COUNT
  ) {
    return false;
  }
  if (rec.decodeMsEwma !== undefined) {
    if (
      typeof rec.decodeMsEwma !== "number" ||
      !Number.isFinite(rec.decodeMsEwma) ||
      rec.decodeMsEwma < 0 ||
      rec.decodeMsEwma > MAX_CLIENT_DECODE_MS
    ) {
      return false;
    }
  }
  return true;
}

function validateMediaClientControlFields(val: unknown): val is MediaClientControl {
  if (!val || typeof val !== "object" || Array.isArray(val)) return false;
  const rec = val as Record<string, unknown>;
  if (
    typeof rec.subscriptionEpoch !== "string" ||
    rec.subscriptionEpoch.length === 0 ||
    mediaControlTextEncoder.encode(rec.subscriptionEpoch).byteLength >
      MAX_SUBSCRIPTION_EPOCH_BYTES
  ) {
    return false;
  }
  switch (rec.kind) {
    case "frameAck": {
      for (const k of Object.keys(rec)) {
        if (
          k !== "kind" &&
          k !== "subscriptionEpoch" &&
          k !== "producerRun" &&
          k !== "viewportEpoch" &&
          k !== "frameSeq" &&
          k !== "reason" &&
          k !== "decodeMs"
        ) {
          return false;
        }
      }
      if (
        typeof rec.producerRun !== "string" ||
        !MEDIA_CONTROL_UUID_RE.test(rec.producerRun) ||
        !isValidPositiveDecimalU64(rec.viewportEpoch) ||
        !isValidPositiveDecimalU64(rec.frameSeq)
      ) {
        return false;
      }
      if (rec.reason !== undefined) {
        if (
          typeof rec.reason !== "string" ||
          rec.reason.length === 0 ||
          mediaControlTextEncoder.encode(rec.reason).byteLength >
            MAX_MEDIA_CONTROL_REASON_BYTES
        ) {
          return false;
        }
      }
      if (rec.decodeMs !== undefined) {
        if (
          typeof rec.decodeMs !== "number" ||
          !Number.isFinite(rec.decodeMs) ||
          rec.decodeMs < 0 ||
          rec.decodeMs > MAX_CLIENT_DECODE_MS
        ) {
          return false;
        }
      }
      return true;
    }
    case "frameDiscarded": {
      for (const k of Object.keys(rec)) {
        if (
          k !== "kind" &&
          k !== "subscriptionEpoch" &&
          k !== "producerRun" &&
          k !== "viewportEpoch" &&
          k !== "frameSeq" &&
          k !== "reason"
        ) {
          return false;
        }
      }
      if (
        typeof rec.producerRun !== "string" ||
        !MEDIA_CONTROL_UUID_RE.test(rec.producerRun) ||
        !isValidPositiveDecimalU64(rec.viewportEpoch) ||
        !isValidPositiveDecimalU64(rec.frameSeq)
      ) {
        return false;
      }
      if (
        rec.reason !== undefined &&
        (typeof rec.reason !== "string" ||
          !Object.hasOwn(VALID_DISCARD_REASONS, rec.reason))
      ) {
        return false;
      }
      return true;
    }
    case "pause": {
      return Object.keys(rec).every(
        (k) => k === "kind" || k === "subscriptionEpoch",
      );
    }
    case "heartbeat": {
      for (const k of Object.keys(rec)) {
        if (
          k !== "kind" &&
          k !== "subscriptionEpoch" &&
          k !== "visible" &&
          k !== "telemetry"
        ) {
          return false;
        }
      }
      if (typeof rec.visible !== "boolean") return false;
      if (
        rec.telemetry !== undefined &&
        !isValidHeartbeatTelemetry(rec.telemetry)
      ) {
        return false;
      }
      return true;
    }
    default:
      return false;
  }
}

export function serializeMediaClientControl(
  val: unknown,
): string | null {
  if (!validateMediaClientControlFields(val)) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(val);
  } catch {
    return null;
  }
  if (
    !serialized ||
    mediaControlTextEncoder.encode(serialized).byteLength >
      MAX_MEDIA_CONTROL_BYTES
  ) {
    return null;
  }
  return serialized;
}

export function isValidMediaClientControl(
  val: unknown,
): val is MediaClientControl {
  return serializeMediaClientControl(val) !== null;
}
export interface BrowserAudioChunk {
  kind: "audioChunk";
  browserSessionId: string;
  browserIncarnation: string;
  profileEpoch: string;
  producerRun: string;
  subscriptionEpoch: string;
  docEpoch: string;
  audioSeq: string;
  sampleRate: number;
  channels: number;
  encoding: "pcm16le";
  data: string;
}

export type ServerControlEvent =
  | {
      kind: "sessionUpdated";
      session: BrowserSessionDto;
    }
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

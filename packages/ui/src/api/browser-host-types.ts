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

export interface BrowserDownloadSummary {
  guid: string;
  suggestedFilename: string;
  state: "inProgress" | "completed" | "canceled";
  receivedBytes: number;
  totalBytes: number;
  filePath?: string;
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
  lastDownload?: BrowserDownloadSummary | null;
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
  navigationRevision: string;
}

export interface HistoryRequest {
  direction: "back" | "forward";
  navigationRevision: string;
}

export interface ReloadRequest {
  navigationRevision: string;
}

export interface SetViewportRequest {
  leaseToken: string;
  viewportEpoch: string;
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
  profileEpoch: string;
}

export interface IssueTicketResponse {
  ticket: string;
  expiresAtUnixMs: number;
}

export interface CreateDevToolsLeaseRequest {
  viewerId: string;
  leaseToken: string;
}

export interface DevToolsLeaseResponse {
  token: string;
  expiresAtUnixMs: number;
  browserSessionId: string;
  browserIncarnation: string;
  profileEpoch: string;
  viewerId: string;
  controlEpoch: string;
}

export interface ProfileResetRequest {
  operationId: string;
  expectedProfileEpoch: string;
  confirmed: boolean;
}

export interface ProfileResetResponse {
  status: "completed" | "cleanupPending";
  profileEpoch: string;
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
    }
  | {
      kind: "qualityPreference";
      subscriptionEpoch: string;
      preference: QualityPreference;
    }
  | {
      kind: "muteState";
      subscriptionEpoch: string;
      muted: boolean;
    };

export type QualityPreference = "auto" | "high" | "medium" | "low";
export type StreamQualityTier = "high" | "medium" | "low" | "constrained";
export type AudioSuppressionReason =
  | "muted"
  | "bandwidth"
  | "hidden"
  | "stalled";
export type StreamQualityStatus =
  | "warming"
  | "switching"
  | "effective"
  | "unavailable";

export interface StreamQualityEvent {
  kind: "streamQuality";
  subscriptionEpoch: string;
  preference: QualityPreference;
  producerRun: string;
  captureVersion: string;
  sharedTier: StreamQualityTier;
  viewerTier: StreamQualityTier;
  fps: number;
  jpegQuality: number;
  scale: number;
  imageWidth: number;
  imageHeight: number;
  audioSuppressed: boolean;
  audioReason: AudioSuppressionReason | null;
  status: StreamQualityStatus;
}

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

export function isValidPositiveDecimalU64(val: unknown): val is string {
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
    case "qualityPreference": {
      for (const k of Object.keys(rec)) {
        if (k !== "kind" && k !== "subscriptionEpoch" && k !== "preference") {
          return false;
        }
      }
      return (
        rec.preference === "auto" ||
        rec.preference === "high" ||
        rec.preference === "medium" ||
        rec.preference === "low"
      );
    }
    case "muteState": {
      for (const k of Object.keys(rec)) {
        if (k !== "kind" && k !== "subscriptionEpoch" && k !== "muted") {
          return false;
        }
      }
      return typeof rec.muted === "boolean";
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
  audioRun: string;
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

export type MediaServerText = BrowserAudioChunk | StreamQualityEvent;

const BASE64_CHUNK_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function isValidPcmBase64(b64: string): boolean {
  if (
    typeof b64 !== "string" ||
    b64.length === 0 ||
    b64.length > MAX_AUDIO_BASE64_BYTES ||
    b64.length % 4 !== 0 ||
    !BASE64_CHUNK_PATTERN.test(b64)
  ) {
    return false;
  }
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return false;
  }
  const len = bin.length;
  if (len === 0 || (len & 1) !== 0 || len > MAX_AUDIO_PCM_BYTES) return false;
  try {
    if (btoa(bin) !== b64) return false;
  } catch {
    return false;
  }
  return true;
}
const AUDIO_CHUNK_KEYS: Record<string, true> = {
  kind: true,
  browserSessionId: true,
  browserIncarnation: true,
  profileEpoch: true,
  audioRun: true,
  subscriptionEpoch: true,
  docEpoch: true,
  audioSeq: true,
  sampleRate: true,
  channels: true,
  encoding: true,
  data: true,
};

const STREAM_QUALITY_KEYS: Record<string, true> = {
  kind: true,
  subscriptionEpoch: true,
  preference: true,
  producerRun: true,
  captureVersion: true,
  sharedTier: true,
  viewerTier: true,
  fps: true,
  jpegQuality: true,
  scale: true,
  imageWidth: true,
  imageHeight: true,
  audioSuppressed: true,
  audioReason: true,
  status: true,
};

export function parseMediaServerText(raw: unknown): MediaServerText | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (
    raw.length > MAX_AUDIO_MESSAGE_BYTES ||
    mediaControlTextEncoder.encode(raw).byteLength > MAX_AUDIO_MESSAGE_BYTES
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;

  if (rec.kind === "audioChunk") {
    const keys = Object.keys(rec);
    if (keys.length !== 12) return null;
    for (const k of keys) {
      if (!AUDIO_CHUNK_KEYS[k]) return null;
    }
    if (
      rec.sampleRate !== AUDIO_SAMPLE_RATE ||
      rec.channels !== AUDIO_CHANNELS ||
      rec.encoding !== AUDIO_ENCODING_PCM16LE ||
      typeof rec.browserSessionId !== "string" ||
      !MEDIA_CONTROL_UUID_RE.test(rec.browserSessionId) ||
      typeof rec.browserIncarnation !== "string" ||
      !MEDIA_CONTROL_UUID_RE.test(rec.browserIncarnation) ||
      typeof rec.audioRun !== "string" ||
      !MEDIA_CONTROL_UUID_RE.test(rec.audioRun) ||
      typeof rec.subscriptionEpoch !== "string" ||
      rec.subscriptionEpoch.length === 0 ||
      mediaControlTextEncoder.encode(rec.subscriptionEpoch).byteLength >
        MAX_SUBSCRIPTION_EPOCH_BYTES ||
      !isValidPositiveDecimalU64(rec.profileEpoch) ||
      !isValidPositiveDecimalU64(rec.docEpoch) ||
      !isValidPositiveDecimalU64(rec.audioSeq) ||
      typeof rec.data !== "string" ||
      !isValidPcmBase64(rec.data)
    ) {
      return null;
    }
    return rec as unknown as BrowserAudioChunk;
  }

  if (rec.kind === "streamQuality") {
    const keys = Object.keys(rec);
    if (keys.length !== 15) return null;
    for (const k of keys) {
      if (!STREAM_QUALITY_KEYS[k]) return null;
    }
    if (
      typeof rec.subscriptionEpoch !== "string" ||
      rec.subscriptionEpoch.length === 0 ||
      mediaControlTextEncoder.encode(rec.subscriptionEpoch).byteLength >
        MAX_SUBSCRIPTION_EPOCH_BYTES ||
      (rec.preference !== "auto" &&
        rec.preference !== "high" &&
        rec.preference !== "medium" &&
        rec.preference !== "low") ||
      typeof rec.producerRun !== "string" ||
      !MEDIA_CONTROL_UUID_RE.test(rec.producerRun) ||
      !isValidPositiveDecimalU64(rec.captureVersion) ||
      (rec.sharedTier !== "high" &&
        rec.sharedTier !== "medium" &&
        rec.sharedTier !== "low" &&
        rec.sharedTier !== "constrained") ||
      (rec.viewerTier !== "high" &&
        rec.viewerTier !== "medium" &&
        rec.viewerTier !== "low" &&
        rec.viewerTier !== "constrained") ||
      typeof rec.fps !== "number" ||
      !Number.isInteger(rec.fps) ||
      rec.fps < 1 ||
      rec.fps > 30 ||
      typeof rec.jpegQuality !== "number" ||
      !Number.isInteger(rec.jpegQuality) ||
      rec.jpegQuality < 1 ||
      rec.jpegQuality > 100 ||
      typeof rec.scale !== "number" ||
      !Number.isFinite(rec.scale) ||
      rec.scale <= 0 ||
      rec.scale > 1 ||
      typeof rec.imageWidth !== "number" ||
      !Number.isInteger(rec.imageWidth) ||
      rec.imageWidth < 1 ||
      rec.imageWidth > MAX_IMAGE_WIDTH ||
      typeof rec.imageHeight !== "number" ||
      !Number.isInteger(rec.imageHeight) ||
      rec.imageHeight < 1 ||
      rec.imageHeight > MAX_IMAGE_HEIGHT ||
      !Object.hasOwn(rec, "audioReason") ||
      (rec.audioReason !== null &&
        rec.audioReason !== "muted" &&
        rec.audioReason !== "bandwidth" &&
        rec.audioReason !== "hidden" &&
        rec.audioReason !== "stalled") ||
      rec.audioSuppressed !== (rec.audioReason !== null) ||
      (rec.status !== "warming" &&
        rec.status !== "switching" &&
        rec.status !== "effective" &&
        rec.status !== "unavailable")
    ) {
      return null;
    }
    return rec as unknown as StreamQualityEvent;
  }

  return null;
}

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
  profileEpoch: string;
  subscriptionEpoch: string;
  leaseToken: string;
  inputSeq: string;
  viewportEpoch: string;
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

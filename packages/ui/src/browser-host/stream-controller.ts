/**
 * Bounded Canvas Stream Controller.
 *
 * Implements persistent canvas decoder and exact frame dispositions per architecture-contracts.md §7:
 * - 1 active decode + 1 latest pending compressed buffer.
 * - Replacing pending sends frameDiscarded with reason 'replaced'.
 * - Closes every ImageBitmap in finally.
 * - Synchronous black canvas clearing on privacy activation.
 * - Late completions fenced by decodeEpoch and originating socket/subscription context.
 * - Heartbeat (5s) and release/dispose teardown.
 */

import {
  serializeMediaClientControl,
  MAX_AUDIO_MESSAGE_BYTES,
  MAX_CLIENT_DECODE_MS,
  MAX_HEARTBEAT_FRAME_COUNT,
  MAX_HEARTBEAT_SAMPLE_MS,
  parseMediaServerText,
  type BrowserAudioChunk,
  type HeartbeatTelemetry,
  type MediaClientControl,
  type QualityPreference,
  type ServerControlEvent,
  type StreamQualityEvent,
  type TargetFrameHeader,
  type TargetGeometry,
} from "../api/browser-host-types.js";
import type { ViewerAttachmentCredentials } from "../api/browser-host-client.js";
import { isSecureOrLoopbackOrigin } from "../api/auth-client.js";
import { unpackBhjfFrame } from "./frame-protocol.js";
const DECIMAL_SEQ_PATTERN = /^[1-9][0-9]{0,19}$/;
const textEncoder = new TextEncoder();
const MAX_U64 = 18446744073709551615n;
/** Bit 63 of a server viewport epoch marks an in-progress geometry transition (not a real epoch). */
const TRANSITIONAL_EPOCH_FLAG = 1n << 63n;
type TimeoutHandle = ReturnType<typeof setTimeout>;

function parsePositiveU64(value: unknown): bigint | null {
  if (typeof value !== "string" || !DECIMAL_SEQ_PATTERN.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= MAX_U64 ? parsed : null;
}

export interface DrawnRect {
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  imageWidth: number;
  imageHeight: number;
  geometry: TargetGeometry;
  viewportEpoch: string;
  inputTrusted: boolean;
}

export interface FramePresentMetrics {
  frameSeq: string;
  viewportEpoch: string;
  producerRun: string;
  captureTimeUnixMs: number;
  presentTimeUnixMs: number;
}

export interface StreamTelemetrySnapshot {
  windowDecodedFrames: number;
  windowReplacedFrames: number;
  totalDecodedFrames: number;
  totalReplacedFrames: number;
  lastDecodeMs: number | null;
  decodeMsEwma: number | null;
}

export interface StreamControllerOptions {
  canvas: HTMLCanvasElement;
  onGeometryChange?: (geom: TargetGeometry, inputTrusted: boolean) => void;
  onControlEvent?: (event: ServerControlEvent, credentials: ViewerAttachmentCredentials) => void;
  onAudioChunk?: (chunk: BrowserAudioChunk, credentials: ViewerAttachmentCredentials) => void;
  onAudioReset?: () => void;
  onStreamQuality?: (
    event: StreamQualityEvent,
    credentials: ViewerAttachmentCredentials,
  ) => void;
  onStreamQualityReset?: () => void;
  onStatusChange?: (status: StreamStatus) => void;
  onError?: (err: Error) => void;
  onPresentFrame?: (metrics: FramePresentMetrics) => void;
}

export type StreamStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "paused"
  | "privacy"
  | "disconnected"
  | "unsupported"
  | "error";

interface PendingFrame {
  jpegPayload: Uint8Array;
  socket: WebSocket;
  subscriptionEpoch: string;
  header: TargetFrameHeader;
}

export class BrowserStreamController {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  private readonly onGeometryChange?: (
    geom: TargetGeometry,
    inputTrusted: boolean,
  ) => void;
  private readonly onControlEvent?: StreamControllerOptions["onControlEvent"];
  private readonly onAudioChunk?: StreamControllerOptions["onAudioChunk"];
  private readonly onAudioReset?: StreamControllerOptions["onAudioReset"];
  private readonly onStreamQuality?: StreamControllerOptions["onStreamQuality"];
  private readonly onStreamQualityReset?: StreamControllerOptions["onStreamQualityReset"];
  private readonly onStatusChange?: (status: StreamStatus) => void;
  private readonly onError?: (err: Error) => void;
  private readonly onPresentFrame?: (metrics: FramePresentMetrics) => void;
  private mediaWs: WebSocket | null = null;
  private controlWs: WebSocket | null = null;
  private currentCredentials: ViewerAttachmentCredentials | null = null;

  private isDecoding = false;
  private pending: PendingFrame | null = null;
  private decodeEpoch = 0;

  private isPrivacyActive = false;
  private isVisible = true;
  private isDisposed = false;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastDrawnRect: DrawnRect | null = null;
  private lastFrameHeader: TargetFrameHeader | null = null;
  private lastCachedBitmap: ImageBitmap | null = null;
  /** Newest canonical viewportEpoch seen on this attachment; older in-flight decodes are obsolete. */
  private newestViewportEpoch: bigint | null = null;
  /** Identity of the owner/target whose pixels are currently cached; a different one retires them. */
  private presentationOwnerKey: string | null = null;
  private status: StreamStatus = "idle";
  private currentProducerRun: string | null = null;
  private lastKnownProducerRun: string | null = null;
  private lastAudioSeq = 0n;
  private lastAudioDocEpoch = 1n;
  private retiredAudioDocEpoch = 0n;
  private seenAudioInCurrentDoc = false;
  private audioAttachmentRetired = false;
  private readonly retiredProducerRuns = new Set<string>();
  private currentAudioRun: string | null = null;
  private readonly retiredAudioRuns = new Set<string>();
  private currentQualityPreference: QualityPreference = "auto";
  private currentAudioMuted = true;
  private lastQualityPrefSentAt = 0;
  private lastMuteSentAt = 0;
  private pendingQualityPreference: QualityPreference | null = null;
  private pendingQualityTimer: TimeoutHandle | null = null;
  private pendingMuteState: boolean | null = null;
  private pendingMuteTimer: TimeoutHandle | null = null;
  private lastStreamQualityEvent: StreamQualityEvent | null = null;
  private readonly appliedCaptureVersionsByRun = new Map<string, bigint>();
  private streamQualityActive = false;
  private telemetryWindowStartMonoMs = 0;
  private windowDecodedFrames = 0;
  private windowReplacedFrames = 0;
  private totalDecodedFrames = 0;
  private totalReplacedFrames = 0;
  private lastDecodeMs: number | null = null;
  private decodeMsEwma: number | null = null;
  constructor(options: StreamControllerOptions) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.onGeometryChange = options.onGeometryChange;
    this.onControlEvent = options.onControlEvent;
    this.onAudioChunk = options.onAudioChunk;
    this.onAudioReset = options.onAudioReset;
    this.onStreamQuality = options.onStreamQuality;
    this.onStreamQualityReset = options.onStreamQualityReset;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;
    this.onPresentFrame = options.onPresentFrame;
  }

  public getStatus(): StreamStatus {
    return this.status;
  }

  public getDrawnRect(): DrawnRect | null {
    return this.lastDrawnRect;
  }

  public getControlSocket(): WebSocket | null {
    return this.controlWs;
  }

  public getCurrentSubscriptionEpoch(): string | null {
    return this.currentCredentials?.subscriptionEpoch ?? null;
  }

  public getQualityPreference(): QualityPreference {
    return this.currentQualityPreference;
  }

  public getTelemetrySnapshot(): StreamTelemetrySnapshot {
    return {
      windowDecodedFrames: this.windowDecodedFrames,
      windowReplacedFrames: this.windowReplacedFrames,
      totalDecodedFrames: this.totalDecodedFrames,
      totalReplacedFrames: this.totalReplacedFrames,
      lastDecodeMs: this.lastDecodeMs,
      decodeMsEwma: this.decodeMsEwma,
    };
  }

  private nowMonoMs(): number {
    return typeof performance !== "undefined" &&
      typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  private resetTelemetryAggregates(): void {
    this.telemetryWindowStartMonoMs = this.nowMonoMs();
    this.windowDecodedFrames = 0;
    this.windowReplacedFrames = 0;
    this.totalDecodedFrames = 0;
    this.totalReplacedFrames = 0;
    this.lastDecodeMs = null;
    this.decodeMsEwma = null;
  }

  private sanitizeDecodeMs(rawMs: number): number | null {
    if (typeof rawMs !== "number" || !Number.isFinite(rawMs) || rawMs < 0) {
      return null;
    }
    const clamped = Math.min(MAX_CLIENT_DECODE_MS, rawMs);
    return Math.round(clamped * 100) / 100;
  }
  private setStatus(newStatus: StreamStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.onStatusChange?.(newStatus);
    }
  }

  /**
   * Attaches new media and control WebSockets using freshly minted credentials.
   * Cleans up any prior socket without reassigning old context to the new connection.
   */
  public attach(credentials: ViewerAttachmentCredentials): void {
    if (this.isDisposed) return;

    // Invalidate active decode, audio state, and previous pending frame on reattach
    this.decodeEpoch++;
    this.audioAttachmentRetired = false;
    this.retiredProducerRuns.clear();
    this.lastKnownProducerRun = null;
    this.currentAudioRun = null;
    this.retiredAudioRuns.clear();
    this.lastAudioSeq = 0n;
    this.lastAudioDocEpoch = 1n;
    this.retiredAudioDocEpoch = 0n;
    this.seenAudioInCurrentDoc = false;
    this.lastStreamQualityEvent = null;
    this.appliedCaptureVersionsByRun.clear();
    this.clearRateLimitTimers();
    this.resetAudioState();
    const ownerKey = [
      credentials.owner.profileId,
      credentials.owner.generation,
      credentials.browserSessionId,
      credentials.browserIncarnation,
      credentials.profileEpoch,
    ].join("|");
    // Pixels, hit rectangle and header belong to one owner/target: a different one must never
    // see them, even for a layout redraw before its first frame. Same-owner reconnects keep them.
    if (this.presentationOwnerKey !== null && this.presentationOwnerKey !== ownerKey) {
      this.retireCachedPresentation();
    }
    this.presentationOwnerKey = ownerKey;
    this.resetTelemetryAggregates();
    if (this.pending) {
      const prev = this.pending;
      this.pending = null;
      this.sendMediaControl(prev.socket, {
        kind: "frameDiscarded",
        subscriptionEpoch: prev.subscriptionEpoch,
        producerRun: prev.header.producerRun,
        viewportEpoch: prev.header.viewportEpoch,
        frameSeq: prev.header.frameSeq,
        reason: "obsolete",
      });
    }
    this.detachSockets();
    this.audioAttachmentRetired = false;

    const mediaHttpEquiv = credentials.mediaWsUrl.replace(/^ws(s?):/, "http$1:");
    const controlHttpEquiv = credentials.controlWsUrl.replace(/^ws(s?):/, "http$1:");
    if (
      !isSecureOrLoopbackOrigin(mediaHttpEquiv) ||
      !isSecureOrLoopbackOrigin(controlHttpEquiv)
    ) {
      this.currentCredentials = null;
      this.setStatus("error");
      this.onError?.(
        new Error(
          "Browser stream WebSocket requires a wss:// or loopback ws:// origin",
        ),
      );
      return;
    }

    this.currentCredentials = credentials;
    this.setStatus("connecting");
    this.streamQualityActive = true;
    try {
      const media = new WebSocket(
        credentials.mediaWsUrl,
        credentials.mediaSubprotocols,
      );
      media.binaryType = "arraybuffer";
      this.mediaWs = media;

      const control = new WebSocket(
        credentials.controlWsUrl,
        credentials.controlSubprotocols,
      );
      this.controlWs = control;

      const subEpoch = credentials.subscriptionEpoch;

      media.onopen = () => {
        if (this.isDisposed || this.mediaWs !== media) return;
        this.streamQualityActive = true;
        this.sendQualityPreferenceNow(this.currentQualityPreference);
        this.sendMuteStateNow(this.currentAudioMuted);
        this.setStatus("streaming");
        this.startHeartbeat(media, subEpoch);
      };

      media.onmessage = (event: MessageEvent) => {
        if (
          this.isDisposed ||
          this.isPrivacyActive ||
          !this.isVisible ||
          this.mediaWs !== media ||
          this.currentCredentials !== credentials
        ) {
          return;
        }
        if (typeof event.data === "string") {
          this.handleIncomingMediaText(event.data, media, credentials);
          return;
        }
        if (!(event.data instanceof ArrayBuffer)) return;

        this.handleIncomingMediaMessage(event.data, media, subEpoch);
      };

      media.onclose = () => {
        if (this.mediaWs === media) {
          this.mediaWs = null;
          this.audioAttachmentRetired = true;
          this.resetAudioState();
          this.notifyStreamQualityReset();
          if (this.status === "streaming" || this.status === "connecting") {
            this.setStatus("disconnected");
          }
        }
      };

      media.onerror = (err) => {
        if (this.isDisposed || this.mediaWs !== media) return;
        this.notifyStreamQualityReset();
        this.onError?.(
          new Error(`Media WebSocket error: ${String(err)}`),
        );
      };

      control.onmessage = (event: MessageEvent) => {
        if (this.isDisposed || this.controlWs !== control ||
            this.currentCredentials !== credentials) return;
        if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data) as ServerControlEvent;
            this.onControlEvent?.(parsed, credentials);
          } catch {
            // Ignore malformed control event
          }
        }
      };

      control.onclose = () => {
        if (this.controlWs === control) {
          this.controlWs = null;
          this.audioAttachmentRetired = true;
          this.resetAudioState();
          this.notifyStreamQualityReset();
        }
      };
    } catch (err) {
      this.setStatus("error");
      this.notifyStreamQualityReset();
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
  private startHeartbeat(socket: WebSocket, subscriptionEpoch: string): void {
    this.stopHeartbeat();
    this.telemetryWindowStartMonoMs = this.nowMonoMs();
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN && !this.isPrivacyActive) {
        const now = this.nowMonoMs();
        const hasSamples =
          this.windowDecodedFrames > 0 ||
          this.windowReplacedFrames > 0 ||
          this.decodeMsEwma !== null;
        let telemetry: HeartbeatTelemetry | undefined;
        if (hasSamples) {
          const rawSampleMs = Math.round(
            Math.max(0, now - this.telemetryWindowStartMonoMs),
          );
          const sampleMs = Math.min(
            MAX_HEARTBEAT_SAMPLE_MS,
            Number.isFinite(rawSampleMs) ? rawSampleMs : 0,
          );
          const ewma =
            this.decodeMsEwma !== null
              ? this.sanitizeDecodeMs(this.decodeMsEwma)
              : null;
          telemetry = {
            sampleMs,
            decodedFrames: Math.min(
              MAX_HEARTBEAT_FRAME_COUNT,
              this.windowDecodedFrames,
            ),
            replacedFrames: Math.min(
              MAX_HEARTBEAT_FRAME_COUNT,
              this.windowReplacedFrames,
            ),
            ...(ewma !== null ? { decodeMsEwma: ewma } : {}),
          };
          this.windowDecodedFrames = 0;
          this.windowReplacedFrames = 0;
        }
        this.telemetryWindowStartMonoMs = now;
        this.sendMediaControl(socket, {
          kind: "heartbeat",
          subscriptionEpoch,
          visible: this.isVisible,
          ...(telemetry ? { telemetry } : {}),
        });
      }
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendMediaControl(socket: WebSocket, ctrl: MediaClientControl): void {
    if (socket.readyState === WebSocket.OPEN) {
      const serialized = serializeMediaClientControl(ctrl);
      if (serialized === null) {
        return;
      }
      try {
        socket.send(serialized);
      } catch {
        // Socket send error handled by ws lifecycle
      }
    }
  }

  public resetAudioAuthority(minDocEpoch?: string | number | bigint): void {
    if (minDocEpoch !== undefined) {
      const targetEpoch = parsePositiveU64(String(minDocEpoch));
      if (targetEpoch !== null) {
        const retireBelow = targetEpoch - 1n;
        const alreadyOnTargetDoc =
          this.seenAudioInCurrentDoc && this.lastAudioDocEpoch >= targetEpoch;
        const alreadyResetForTarget =
          !this.seenAudioInCurrentDoc &&
          this.retiredAudioDocEpoch >= retireBelow &&
          this.lastAudioDocEpoch >= targetEpoch;
        if (retireBelow > this.retiredAudioDocEpoch) {
          this.retiredAudioDocEpoch = retireBelow;
        }
        if (alreadyOnTargetDoc || alreadyResetForTarget) {
          return;
        }
        if (targetEpoch > this.lastAudioDocEpoch) {
          this.lastAudioDocEpoch = targetEpoch;
        }
        this.seenAudioInCurrentDoc = false;
        this.resetAudioState();
        return;
      }
    }
    if (this.lastAudioDocEpoch > this.retiredAudioDocEpoch) {
      this.retiredAudioDocEpoch = this.lastAudioDocEpoch;
    }
    this.seenAudioInCurrentDoc = false;
    this.resetAudioState();
  }

  private retireProducerRun(run: string): void {
    if (this.retiredProducerRuns.size >= 16) {
      const oldest = this.retiredProducerRuns.values().next().value;
      if (oldest !== undefined) {
        this.retiredProducerRuns.delete(oldest);
      }
    }
    this.retiredProducerRuns.add(run);
  }

  private recordAppliedCaptureVersion(run: string, version: bigint): void {
    const current = this.appliedCaptureVersionsByRun.get(run) ?? 0n;
    if (version > current) {
      if (
        !this.appliedCaptureVersionsByRun.has(run) &&
        this.appliedCaptureVersionsByRun.size >= 16
      ) {
        const oldest = this.appliedCaptureVersionsByRun.keys().next().value;
        if (oldest !== undefined) {
          this.appliedCaptureVersionsByRun.delete(oldest);
        }
      }
      this.appliedCaptureVersionsByRun.delete(run);
      this.appliedCaptureVersionsByRun.set(run, version);
    }
  }

  private resetAudioState(): void {
    this.onAudioReset?.();
  }

  private retireAudioRun(run: string): void {
    if (this.retiredAudioRuns.size >= 16) {
      const oldest = this.retiredAudioRuns.values().next().value;
      if (oldest !== undefined) {
        this.retiredAudioRuns.delete(oldest);
      }
    }
    this.retiredAudioRuns.add(run);
  }

  private handleIncomingMediaText(
    raw: string,
    socket: WebSocket,
    credentials: ViewerAttachmentCredentials,
  ): void {
    if (
      this.isDisposed ||
      this.isPrivacyActive ||
      !this.isVisible ||
      this.audioAttachmentRetired ||
      this.mediaWs !== socket ||
      !this.controlWs ||
      this.currentCredentials !== credentials ||
      raw.length === 0 ||
      raw.length > MAX_AUDIO_MESSAGE_BYTES ||
      textEncoder.encode(raw).byteLength > MAX_AUDIO_MESSAGE_BYTES
    ) {
      return;
    }
    const message = parseMediaServerText(raw);
    if (!message) return;

    if (message.kind === "streamQuality") {
      this.handleStreamQualityEvent(message, credentials);
      return;
    }

    if (message.kind === "audioChunk") {
      this.handleAudioChunk(message, credentials);
      return;
    }
  }

  private handleStreamQualityEvent(
    event: StreamQualityEvent,
    credentials: ViewerAttachmentCredentials,
  ): void {
    if (
      this.isDisposed ||
      this.isPrivacyActive ||
      !this.isVisible ||
      this.audioAttachmentRetired ||
      this.currentCredentials !== credentials ||
      event.subscriptionEpoch !== credentials.subscriptionEpoch
    ) {
      return;
    }
    if (this.retiredProducerRuns.has(event.producerRun)) {
      return;
    }

    const isAppliedFenceStatus =
      event.status === "effective" || event.status === "switching";

    if (isAppliedFenceStatus) {
      const v = BigInt(event.captureVersion);
      const lastApplied =
        this.appliedCaptureVersionsByRun.get(event.producerRun) ?? 0n;
      if (v < lastApplied) {
        return;
      }
    }

    if (this.lastStreamQualityEvent !== null) {
      const prev = this.lastStreamQualityEvent;
      if (
        prev.subscriptionEpoch === event.subscriptionEpoch &&
        prev.preference === event.preference &&
        prev.producerRun === event.producerRun &&
        prev.captureVersion === event.captureVersion &&
        prev.sharedTier === event.sharedTier &&
        prev.viewerTier === event.viewerTier &&
        prev.fps === event.fps &&
        prev.jpegQuality === event.jpegQuality &&
        prev.scale === event.scale &&
        prev.imageWidth === event.imageWidth &&
        prev.imageHeight === event.imageHeight &&
        prev.audioSuppressed === event.audioSuppressed &&
        prev.audioReason === event.audioReason &&
        prev.status === event.status
      ) {
        return;
      }
    }

    if (isAppliedFenceStatus) {
      const v = BigInt(event.captureVersion);
      this.recordAppliedCaptureVersion(event.producerRun, v);
    }

    this.lastStreamQualityEvent = event;
    this.onStreamQuality?.(event, credentials);
  }

  private handleAudioChunk(
    chunk: BrowserAudioChunk,
    credentials: ViewerAttachmentCredentials,
  ): void {
    if (
      chunk.browserSessionId !== credentials.browserSessionId ||
      chunk.browserIncarnation !== credentials.browserIncarnation ||
      chunk.profileEpoch !== String(credentials.profileEpoch) ||
      chunk.subscriptionEpoch !== credentials.subscriptionEpoch
    ) {
      return;
    }
    if (this.retiredAudioRuns.has(chunk.audioRun)) {
      return;
    }
    const docEpochVal = parsePositiveU64(chunk.docEpoch);
    const seqVal = parsePositiveU64(chunk.audioSeq);
    if (
      docEpochVal === null ||
      docEpochVal <= this.retiredAudioDocEpoch ||
      docEpochVal < this.lastAudioDocEpoch ||
      seqVal === null
    ) {
      return;
    }

    if (this.currentAudioRun !== chunk.audioRun) {
      if (this.currentAudioRun !== null) {
        this.retireAudioRun(this.currentAudioRun);
        this.lastAudioSeq = 0n;
        this.seenAudioInCurrentDoc = false;
        this.onAudioReset?.();
      }
      this.currentAudioRun = chunk.audioRun;
    }

    if (seqVal <= this.lastAudioSeq) {
      return;
    }

    if (docEpochVal > this.lastAudioDocEpoch) {
      if (docEpochVal - 1n > this.retiredAudioDocEpoch) {
        this.retiredAudioDocEpoch = docEpochVal - 1n;
      }
      this.onAudioReset?.();
    } else if (
      this.seenAudioInCurrentDoc &&
      this.lastAudioSeq > 0n &&
      seqVal > this.lastAudioSeq + 1n
    ) {
      this.onAudioReset?.();
    }
    this.lastAudioDocEpoch = docEpochVal;
    this.seenAudioInCurrentDoc = true;
    this.lastAudioSeq = seqVal;
    this.onAudioChunk?.(chunk, credentials);
  }
  /**
   * Dispatches incoming raw BHJF frame with 1-active-decode + 1-pending-frame boundedness.
   */
  private handleIncomingMediaMessage(
    data: ArrayBuffer,
    socket: WebSocket,
    subscriptionEpoch: string,
  ): void {
    let header: TargetFrameHeader;
    let jpegPayload: Uint8Array;
    try {
      const unpacked = unpackBhjfFrame(data);
      header = unpacked.header;
      jpegPayload = unpacked.jpegPayload;
    } catch (err) {
      this.onError?.(
        new Error(`Failed to unpack frame: ${err instanceof Error ? err.message : String(err)}`),
      );
      return;
    }
    if (
      this.currentCredentials &&
      (header.browserSessionId !== this.currentCredentials.browserSessionId ||
        header.browserIncarnation !== this.currentCredentials.browserIncarnation ||
        String(header.profileEpoch) !== String(this.currentCredentials.profileEpoch))
    ) {
      this.sendMediaControl(socket, {
        kind: "frameDiscarded",
        subscriptionEpoch,
        producerRun: header.producerRun,
        viewportEpoch: header.viewportEpoch,
        frameSeq: header.frameSeq,
        reason: "ownerChanged",
      });
      return;
    }
    if (this.retiredProducerRuns.has(header.producerRun)) {
      this.sendMediaControl(socket, {
        kind: "frameDiscarded",
        subscriptionEpoch,
        producerRun: header.producerRun,
        viewportEpoch: header.viewportEpoch,
        frameSeq: header.frameSeq,
        reason: "obsolete",
      });
      return;
    }

    if (this.lastKnownProducerRun !== header.producerRun) {
      if (this.lastKnownProducerRun !== null) {
        this.retireProducerRun(this.lastKnownProducerRun);
        this.resetTelemetryAggregates();
        if (
          this.pending &&
          this.pending.header.producerRun !== header.producerRun
        ) {
          const stalePending = this.pending;
          this.pending = null;
          this.sendMediaControl(stalePending.socket, {
            kind: "frameDiscarded",
            subscriptionEpoch: stalePending.subscriptionEpoch,
            producerRun: stalePending.header.producerRun,
            viewportEpoch: stalePending.header.viewportEpoch,
            frameSeq: stalePending.header.frameSeq,
            reason: "obsolete",
          });
        }
      }
      this.lastKnownProducerRun = header.producerRun;
    }
    this.currentProducerRun = header.producerRun;
    this.noteViewportEpoch(header.viewportEpoch);
    // Geometry callback
    this.onGeometryChange?.(header.geometry, header.inputTrusted);
    if (this.isDecoding) {
      // Decode is already active: replace pending frame if present
      if (this.pending) {
        const prev = this.pending;
        const isSameRunAndEpoch =
          prev.header.producerRun === header.producerRun &&
          prev.header.viewportEpoch === header.viewportEpoch &&
          !this.retiredProducerRuns.has(prev.header.producerRun);
        if (isSameRunAndEpoch) {
          this.windowReplacedFrames = Math.min(
            MAX_HEARTBEAT_FRAME_COUNT,
            this.windowReplacedFrames + 1,
          );
          this.totalReplacedFrames += 1;
        }
        this.sendMediaControl(prev.socket, {
          kind: "frameDiscarded",
          subscriptionEpoch: prev.subscriptionEpoch,
          producerRun: prev.header.producerRun,
          viewportEpoch: prev.header.viewportEpoch,
          frameSeq: prev.header.frameSeq,
          reason: isSameRunAndEpoch ? "replaced" : "obsolete",
        });
      }
      this.pending = { jpegPayload, socket, subscriptionEpoch, header };
    } else {
      this.decodeAndDrawFrame(jpegPayload, socket, subscriptionEpoch, header);
    }
  }

  /** Records the newest viewportEpoch (canonical decimal string) seen on this attachment. */
  private noteViewportEpoch(viewportEpoch: string): void {
    if (!/^[1-9][0-9]*$/.test(viewportEpoch)) return;
    const epoch = BigInt(viewportEpoch);
    // The server marks an in-progress geometry transition with bit 63. That is a marker, not a
    // real epoch: letting it raise the floor would make every later normal frame look superseded.
    if (epoch >= TRANSITIONAL_EPOCH_FLAG) return;
    if (this.newestViewportEpoch === null || epoch > this.newestViewportEpoch) {
      this.newestViewportEpoch = epoch;
    }
  }

  /** True once a frame with a newer viewportEpoch arrived: the older decode must not paint. */
  private isViewportEpochSuperseded(viewportEpoch: string): boolean {
    if (this.newestViewportEpoch === null || !/^[1-9][0-9]*$/.test(viewportEpoch)) {
      return false;
    }
    return BigInt(viewportEpoch) < this.newestViewportEpoch;
  }

  /**
   * Drops everything painted for the previous owner: cached bitmap, hit rectangle, frame header
   * and canvas pixels, so a resize before the first frame of a new owner can never redraw them.
   */
  private retireCachedPresentation(): void {
    if (this.lastCachedBitmap) {
      try {
        this.lastCachedBitmap.close();
      } catch {
        // Ignore close error on the retired bitmap
      }
      this.lastCachedBitmap = null;
    }
    this.lastDrawnRect = null;
    this.lastFrameHeader = null;
    this.newestViewportEpoch = null;
    if (this.ctx) {
      this.ctx.fillStyle = "#000000";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private isOriginatingOwnerValid(
    socket: WebSocket,
    subscriptionEpoch: string,
    producerRun: string,
    decodeEpoch: number,
    viewportEpoch: string,
  ): boolean {
    return (
      !this.isDisposed &&
      !this.isPrivacyActive &&
      this.isVisible &&
      decodeEpoch === this.decodeEpoch &&
      this.mediaWs === socket &&
      this.currentCredentials?.subscriptionEpoch === subscriptionEpoch &&
      socket.readyState === WebSocket.OPEN &&
      !this.retiredProducerRuns.has(producerRun) &&
      !this.isViewportEpochSuperseded(viewportEpoch) &&
      (this.lastKnownProducerRun === null ||
        this.lastKnownProducerRun === producerRun)
    );
  }

  private async decodeAndDrawFrame(
    jpegPayload: Uint8Array,
    originatingSocket: WebSocket,
    originatingSubEpoch: string,
    header: TargetFrameHeader,
  ): Promise<void> {
    this.isDecoding = true;
    const currentEpoch = ++this.decodeEpoch;
    const decodeStartMonoMs = this.nowMonoMs();

    let bitmap: ImageBitmap | null = null;
    let decodeSucceeded = false;
    if (typeof createImageBitmap !== "function") {
      if (
        this.isOriginatingOwnerValid(
          originatingSocket,
          originatingSubEpoch,
          header.producerRun,
          currentEpoch,
          header.viewportEpoch,
        )
      ) {
        this.lastDrawnRect = null;
        this.lastFrameHeader = null;
        this.setStatus("unsupported");
        this.onError?.(
          new Error(
            "Browser stream decoding unsupported: createImageBitmap is unavailable",
          ),
        );
      }
      this.sendMediaControl(originatingSocket, {
        kind: "frameDiscarded",
        subscriptionEpoch: originatingSubEpoch,
        producerRun: header.producerRun,
        viewportEpoch: header.viewportEpoch,
        frameSeq: header.frameSeq,
        reason: "decodeFailed",
      });
    } else {
      try {
        const jpegBlob = new Blob([jpegPayload as Uint8Array<ArrayBuffer>], {
          type: "image/jpeg",
        });
        bitmap = await createImageBitmap(jpegBlob);
        if (
          !bitmap ||
          typeof bitmap.width !== "number" ||
          typeof bitmap.height !== "number" ||
          bitmap.width <= 0 ||
          bitmap.height <= 0
        ) {
          bitmap?.close?.();
          bitmap = null;
          throw new Error("Decoded ImageBitmap has invalid dimensions");
        }
        decodeSucceeded = true;
      } catch (err) {
        decodeSucceeded = false;
        if (
          this.isOriginatingOwnerValid(
            originatingSocket,
            originatingSubEpoch,
            header.producerRun,
            currentEpoch,
            header.viewportEpoch,
          )
        ) {
          this.lastDrawnRect = null;
          this.lastFrameHeader = null;
          this.setStatus("error");
          this.onError?.(
            err instanceof Error
              ? err
              : new Error(`Frame decode failed: ${String(err)}`),
          );
        }
        this.sendMediaControl(originatingSocket, {
          kind: "frameDiscarded",
          subscriptionEpoch: originatingSubEpoch,
          producerRun: header.producerRun,
          viewportEpoch: header.viewportEpoch,
          frameSeq: header.frameSeq,
          reason: "decodeFailed",
        });
      }
    }

    try {
      // Re-check owner/epoch/privacy and originating socket fidelity
      const isStillValid = this.isOriginatingOwnerValid(
        originatingSocket,
        originatingSubEpoch,
        header.producerRun,
        currentEpoch,
        header.viewportEpoch,
      );
      if (decodeSucceeded && bitmap && isStillValid) {
        const drawSucceeded = this.drawBitmapToCanvas(bitmap, header);
        if (drawSucceeded) {
          if (this.status === "error") {
            this.setStatus("streaming");
          }
          const decodeMs = this.sanitizeDecodeMs(
            this.nowMonoMs() - decodeStartMonoMs,
          );
          if (decodeMs !== null) {
            this.lastDecodeMs = decodeMs;
            this.decodeMsEwma =
              this.decodeMsEwma === null
                ? decodeMs
                : Math.round(
                    (0.25 * decodeMs + 0.75 * this.decodeMsEwma) * 100,
                  ) / 100;
          }
          this.windowDecodedFrames = Math.min(
            MAX_HEARTBEAT_FRAME_COUNT,
            this.windowDecodedFrames + 1,
          );
          this.totalDecodedFrames += 1;
          // Keep cached bitmap for layout redraws
          if (this.lastCachedBitmap && this.lastCachedBitmap !== bitmap) {
            try {
              this.lastCachedBitmap.close();
            } catch {
              // Ignore close error on previous bitmap
            }
          }
          this.lastCachedBitmap = bitmap;

          // Draw then ACK exact key
          this.sendMediaControl(originatingSocket, {
            kind: "frameAck",
            subscriptionEpoch: originatingSubEpoch,
            producerRun: header.producerRun,
            viewportEpoch: header.viewportEpoch,
            frameSeq: header.frameSeq,
            ...(decodeMs !== null ? { decodeMs } : {}),
          });
          this.onPresentFrame?.({
            frameSeq: header.frameSeq,
            viewportEpoch: header.viewportEpoch,
            producerRun: header.producerRun,
            captureTimeUnixMs: header.captureTimeUnixMs,
            presentTimeUnixMs: Date.now(),
          });
        } else {
          try {
            bitmap.close();
          } catch {
            // Ignore close error
          }
          this.lastDrawnRect = null;
          this.lastFrameHeader = null;
          this.setStatus("error");
          this.onError?.(
            new Error("Failed to render decoded browser frame onto canvas"),
          );
          this.sendMediaControl(originatingSocket, {
            kind: "frameDiscarded",
            subscriptionEpoch: originatingSubEpoch,
            producerRun: header.producerRun,
            viewportEpoch: header.viewportEpoch,
            frameSeq: header.frameSeq,
            reason: "decodeFailed",
          });
        }
      } else if (decodeSucceeded && bitmap) {
        // Late or invalidated frame: send discarded control
        this.sendMediaControl(originatingSocket, {
          kind: "frameDiscarded",
          subscriptionEpoch: originatingSubEpoch,
          producerRun: header.producerRun,
          viewportEpoch: header.viewportEpoch,
          frameSeq: header.frameSeq,
          reason: this.isPrivacyActive ? "hidden" : "obsolete",
        });
        bitmap.close();
      }
    } finally {
      this.isDecoding = false;

      // Drain next pending frame if one was queued
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        if (!this.isPrivacyActive && !this.isDisposed) {
          this.decodeAndDrawFrame(
            next.jpegPayload,
            next.socket,
            next.subscriptionEpoch,
            next.header,
          );
        } else {
          this.sendMediaControl(next.socket, {
            kind: "frameDiscarded",
            subscriptionEpoch: next.subscriptionEpoch,
            producerRun: next.header.producerRun,
            viewportEpoch: next.header.viewportEpoch,
            frameSeq: next.header.frameSeq,
            reason: "hidden",
          });
        }
      }
    }
  }

  /**
   * Aspect-fit rendering with letterboxing and canvas clearing.
   * Returns true only when the 2D context is valid, canvas dimensions are positive,
   * and drawImage completes without throwing.
   */
  private drawBitmapToCanvas(
    bitmap: ImageBitmap,
    header: TargetFrameHeader,
  ): boolean {
    if (!this.ctx) {
      this.lastDrawnRect = null;
      this.lastFrameHeader = null;
      return false;
    }

    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    if (canvasW <= 0 || canvasH <= 0 || header.width <= 0 || header.height <= 0) {
      this.lastDrawnRect = null;
      this.lastFrameHeader = null;
      return false;
    }

    const imgW = header.width;
    const imgH = header.height;
    const imageAspect = imgW / imgH;
    const canvasAspect = canvasW / canvasH;

    let drawW: number;
    let drawH: number;
    let drawX: number;
    let drawY: number;

    if (canvasAspect > imageAspect) {
      drawH = canvasH;
      drawW = drawH * imageAspect;
      drawX = (canvasW - drawW) / 2;
      drawY = 0;
    } else {
      drawW = canvasW;
      drawH = drawW / imageAspect;
      drawX = 0;
      drawY = (canvasH - drawH) / 2;
    }

    if (drawW <= 0 || drawH <= 0 || !Number.isFinite(drawW) || !Number.isFinite(drawH)) {
      this.lastDrawnRect = null;
      this.lastFrameHeader = null;
      return false;
    }

    try {
      // Letterbox: clear whole canvas to black
      this.ctx.fillStyle = "#000000";
      this.ctx.fillRect(0, 0, canvasW, canvasH);
      this.ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
    } catch {
      this.lastDrawnRect = null;
      this.lastFrameHeader = null;
      return false;
    }

    this.lastDrawnRect = {
      drawX,
      drawY,
      drawWidth: drawW,
      drawHeight: drawH,
      imageWidth: imgW,
      imageHeight: imgH,
      geometry: header.geometry,
      viewportEpoch: header.viewportEpoch,
      inputTrusted: header.inputTrusted,
    };
    this.lastFrameHeader = header;
    return true;
  }
  /**
   * Redraws the last cached frame (e.g. after canvas resize) maintaining aspect fit.
   */
  public redrawCachedFrame(): void {
    if (
      this.lastCachedBitmap &&
      this.lastFrameHeader &&
      !this.isPrivacyActive &&
      this.isVisible &&
      this.canvas.width > 1 &&
      this.canvas.height > 1
    ) {
      this.drawBitmapToCanvas(this.lastCachedBitmap, this.lastFrameHeader);
    } else {
      this.lastDrawnRect = null;
    }
  }

  public invalidatePresentation(): void {
    this.lastDrawnRect = null;
  }
  /**
   * Synchronously clears the canvas to solid black on Cognito/Privacy activation.
   * Cancels in-flight demand and invalidates decode tokens so late decodes cannot repaint.
   */
  public setPrivacyMode(active: boolean): void {
    this.isPrivacyActive = active;
    this.decodeEpoch++;

    if (active) {
      this.setStatus("privacy");
      this.resetTelemetryAggregates();

      // Synchronously clear canvas to black
      if (this.ctx) {
        this.ctx.fillStyle = "#000000";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
      // Clear cached bitmap and rect to prevent any pre-privacy pixels from redrawing
      if (this.lastCachedBitmap) {
        try {
          this.lastCachedBitmap.close();
        } catch {
          // Ignore close error
        }
        this.lastCachedBitmap = null;
      }
      this.lastDrawnRect = null;
      this.lastFrameHeader = null;
      // Discard pending frame
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.sendMediaControl(p.socket, {
          kind: "frameDiscarded",
          subscriptionEpoch: p.subscriptionEpoch,
          producerRun: p.header.producerRun,
          viewportEpoch: p.header.viewportEpoch,
          frameSeq: p.header.frameSeq,
          reason: "hidden",
        });
      }

      // Close sockets while preserving logical session identity
      this.detachSockets();
    }
  }

  public setVisibility(visible: boolean): void {
    this.isVisible = visible;
    if (!visible) {
      this.setStatus("paused");
      this.decodeEpoch++;
      this.resetTelemetryAggregates();

      if (this.lastCachedBitmap) {
        try {
          this.lastCachedBitmap.close();
        } catch {
          // Ignore close error
        }
        this.lastCachedBitmap = null;
      }
      this.lastDrawnRect = null;
      this.lastFrameHeader = null;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.sendMediaControl(p.socket, {
          kind: "frameDiscarded",
          subscriptionEpoch: p.subscriptionEpoch,
          producerRun: p.header.producerRun,
          viewportEpoch: p.header.viewportEpoch,
          frameSeq: p.header.frameSeq,
          reason: "hidden",
        });
      }
      if (this.mediaWs && this.currentCredentials) {
        this.sendMediaControl(this.mediaWs, {
          kind: "pause",
          subscriptionEpoch: this.currentCredentials.subscriptionEpoch,
        });
      }

      // Detach socket pair per contract C2; resume requires fresh credentials
      this.detachSockets();
      this.currentCredentials = null;
    } else if (this.status === "paused") {
      this.setStatus("disconnected");
    }
  }

  private detachSockets(): void {
    this.stopHeartbeat();
    this.clearRateLimitTimers();
    this.resetAudioState();
    this.notifyStreamQualityReset();

    const media = this.mediaWs;
    const control = this.controlWs;
    // Retire authority before close: queued callbacks can run after detachment.
    this.mediaWs = null;
    this.controlWs = null;
    if (media) {
      try {
        media.close();
      } catch {
        // Ignore close error
      }
    }
    if (control) {
      try {
        control.close();
      } catch {
        // Ignore close error
      }
    }
  }

  /**
   * Complete teardown: closes sockets, closes cached bitmap, blanks canvas.
   */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.decodeEpoch++;
    this.resetTelemetryAggregates();

    this.clearRateLimitTimers();
    this.notifyStreamQualityReset();
    this.detachSockets();
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.sendMediaControl(p.socket, {
        kind: "frameDiscarded",
        subscriptionEpoch: p.subscriptionEpoch,
        producerRun: p.header.producerRun,
        viewportEpoch: p.header.viewportEpoch,
        frameSeq: p.header.frameSeq,
        reason: "obsolete",
      });
    }

    if (this.lastCachedBitmap) {
      try {
        this.lastCachedBitmap.close();
      } catch {
        // Ignore close error
      }
      this.lastCachedBitmap = null;
    }

    if (this.ctx) {
      this.ctx.fillStyle = "#000000";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.setStatus("disconnected");
  }
  public setQualityPreference(pref: QualityPreference): void {
    this.currentQualityPreference = pref;
    if (
      !this.mediaWs ||
      this.mediaWs.readyState !== WebSocket.OPEN ||
      !this.currentCredentials
    ) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastQualityPrefSentAt;
    if (elapsed >= 250) {
      if (this.pendingQualityTimer !== null) {
        clearTimeout(this.pendingQualityTimer);
        this.pendingQualityTimer = null;
      }
      this.pendingQualityPreference = null;
      this.sendQualityPreferenceNow(pref);
    } else {
      this.pendingQualityPreference = pref;
      if (this.pendingQualityTimer === null) {
        this.pendingQualityTimer = setTimeout(() => {
          this.pendingQualityTimer = null;
          if (this.pendingQualityPreference !== null) {
            const toSend = this.pendingQualityPreference;
            this.pendingQualityPreference = null;
            this.sendQualityPreferenceNow(toSend);
          }
        }, 250 - elapsed);
      }
    }
  }

  public setAudioMuted(muted: boolean): void {
    this.currentAudioMuted = muted;
    if (muted) {
      if (this.pendingMuteTimer !== null) {
        clearTimeout(this.pendingMuteTimer);
        this.pendingMuteTimer = null;
      }
      this.pendingMuteState = null;
      this.onAudioReset?.();
      if (
        this.mediaWs &&
        this.mediaWs.readyState === WebSocket.OPEN &&
        this.currentCredentials
      ) {
        this.sendMuteStateNow(true);
      }
      return;
    }

    if (
      !this.mediaWs ||
      this.mediaWs.readyState !== WebSocket.OPEN ||
      !this.currentCredentials
    ) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastMuteSentAt;
    if (elapsed >= 250) {
      if (this.pendingMuteTimer !== null) {
        clearTimeout(this.pendingMuteTimer);
        this.pendingMuteTimer = null;
      }
      this.pendingMuteState = null;
      this.sendMuteStateNow(false);
    } else {
      this.pendingMuteState = false;
      if (this.pendingMuteTimer === null) {
        this.pendingMuteTimer = setTimeout(() => {
          this.pendingMuteTimer = null;
          if (this.pendingMuteState !== null) {
            const toSend = this.pendingMuteState;
            this.pendingMuteState = null;
            this.sendMuteStateNow(toSend);
          }
        }, 250 - elapsed);
      }
    }
  }

  private sendQualityPreferenceNow(pref: QualityPreference): void {
    if (
      !this.mediaWs ||
      this.mediaWs.readyState !== WebSocket.OPEN ||
      !this.currentCredentials
    ) {
      return;
    }
    const control: MediaClientControl = {
      kind: "qualityPreference",
      subscriptionEpoch: this.currentCredentials.subscriptionEpoch,
      preference: pref,
    };
    const serialized = serializeMediaClientControl(control);
    if (serialized) {
      try {
        this.mediaWs.send(serialized);
        this.lastQualityPrefSentAt = Date.now();
      } catch {
        // ignore send failure
      }
    }
  }

  private sendMuteStateNow(muted: boolean): void {
    if (
      !this.mediaWs ||
      this.mediaWs.readyState !== WebSocket.OPEN ||
      !this.currentCredentials
    ) {
      return;
    }
    const control: MediaClientControl = {
      kind: "muteState",
      subscriptionEpoch: this.currentCredentials.subscriptionEpoch,
      muted,
    };
    const serialized = serializeMediaClientControl(control);
    if (serialized) {
      try {
        this.mediaWs.send(serialized);
        this.lastMuteSentAt = Date.now();
      } catch {
        // ignore send failure
      }
    }
  }

  private clearRateLimitTimers(): void {
    if (this.pendingQualityTimer !== null) {
      clearTimeout(this.pendingQualityTimer);
      this.pendingQualityTimer = null;
    }
    this.pendingQualityPreference = null;
    if (this.pendingMuteTimer !== null) {
      clearTimeout(this.pendingMuteTimer);
      this.pendingMuteTimer = null;
    }
    this.pendingMuteState = null;
  }

  private notifyStreamQualityReset(): void {
    if (this.streamQualityActive) {
      this.streamQualityActive = false;
      this.onStreamQualityReset?.();
    }
  }
}

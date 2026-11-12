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
  AUDIO_CHANNELS,
  AUDIO_ENCODING_PCM16LE,
  AUDIO_SAMPLE_RATE,
  serializeMediaClientControl,
  MAX_AUDIO_BASE64_BYTES,
  MAX_AUDIO_MESSAGE_BYTES,
  MAX_AUDIO_PCM_BYTES,
  MAX_CLIENT_DECODE_MS,
  MAX_HEARTBEAT_FRAME_COUNT,
  MAX_HEARTBEAT_SAMPLE_MS,
  MAX_MEDIA_CONTROL_BYTES,
  type BrowserAudioChunk,
  type HeartbeatTelemetry,
  type MediaClientControl,
  type ServerControlEvent,
  type TargetFrameHeader,
  type TargetGeometry,
} from "../api/browser-host-types.js";
import type { ViewerAttachmentCredentials } from "../api/browser-host-client.js";
import { unpackBhjfFrame } from "./frame-protocol.js";

const DECIMAL_SEQ_PATTERN = /^[1-9][0-9]{0,19}$/;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const textEncoder = new TextEncoder();
const BASE64_CHUNK_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_U64 = 18446744073709551615n;

function parsePositiveU64(value: unknown): bigint | null {
  if (typeof value !== "string" || !DECIMAL_SEQ_PATTERN.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= MAX_U64 ? parsed : null;
}

function isValidPcmBase64(b64: string): boolean {
  if (
    !b64 ||
    b64.length > MAX_AUDIO_BASE64_BYTES ||
    b64.length % 4 !== 0 ||
    !BASE64_CHUNK_PATTERN.test(b64)
  ) {
    return false;
  }
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const decodedBytes = (b64.length * 3) / 4 - pad;
  return (
    decodedBytes > 0 &&
    decodedBytes % 2 === 0 &&
    decodedBytes <= MAX_AUDIO_PCM_BYTES
  );
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
  | "error";

interface PendingFrame {
  data: ArrayBuffer;
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
  private status: StreamStatus = "idle";
  private currentProducerRun: string | null = null;
  private lastKnownProducerRun: string | null = null;
  private lastAudioSeq = 0n;
  private lastAudioDocEpoch = 1n;
  private retiredAudioDocEpoch = 0n;
  private seenAudioInCurrentDoc = false;
  private audioAttachmentRetired = false;
  private readonly retiredProducerRuns = new Set<string>();

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
    this.lastAudioSeq = 0n;
    this.lastAudioDocEpoch = 1n;
    this.retiredAudioDocEpoch = 0n;
    this.seenAudioInCurrentDoc = false;
    this.resetAudioState();
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
    this.currentCredentials = credentials;
    this.setStatus("connecting");
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
          if (this.status === "streaming") {
            this.setStatus("disconnected");
          }
        }
      };

      media.onerror = (err) => {
        if (this.isDisposed || this.mediaWs !== media) return;
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
        }
      };
    } catch (err) {
      this.setStatus("error");
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
          this.lastAudioDocEpoch >= targetEpoch &&
          this.currentProducerRun === null;
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

  private resetAudioState(): void {
    this.currentProducerRun = null;
    this.onAudioReset?.();
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const rec = parsed as Record<string, unknown>;
    if (
      rec.kind !== "audioChunk" ||
      rec.browserSessionId !== credentials.browserSessionId ||
      rec.browserIncarnation !== credentials.browserIncarnation ||
      rec.profileEpoch !== String(credentials.profileEpoch) ||
      rec.subscriptionEpoch !== credentials.subscriptionEpoch ||
      typeof rec.producerRun !== "string" ||
      !CANONICAL_UUID_PATTERN.test(rec.producerRun) ||
      this.currentProducerRun === null ||
      rec.producerRun !== this.currentProducerRun ||
      this.retiredProducerRuns.has(rec.producerRun) ||
      rec.sampleRate !== AUDIO_SAMPLE_RATE ||
      rec.channels !== AUDIO_CHANNELS ||
      rec.encoding !== AUDIO_ENCODING_PCM16LE ||
      typeof rec.data !== "string" ||
      !isValidPcmBase64(rec.data)
    ) {
      return;
    }
    const profileEpochVal = parsePositiveU64(rec.profileEpoch);
    const docEpochVal = parsePositiveU64(rec.docEpoch);
    const seqVal = parsePositiveU64(rec.audioSeq);
    if (
      typeof rec.docEpoch !== "string" ||
      profileEpochVal === null ||
      docEpochVal === null ||
      docEpochVal <= this.retiredAudioDocEpoch ||
      docEpochVal < this.lastAudioDocEpoch ||
      seqVal === null ||
      seqVal <= this.lastAudioSeq
    ) {
      return;
    }
    if (docEpochVal > this.lastAudioDocEpoch) {
      if (docEpochVal - 1n > this.retiredAudioDocEpoch) {
        this.retiredAudioDocEpoch = docEpochVal - 1n;
      }
      this.onAudioReset?.();
    } else if (this.seenAudioInCurrentDoc && this.lastAudioSeq > 0n && seqVal > this.lastAudioSeq + 1n) {
      this.onAudioReset?.();
    }
    this.lastAudioDocEpoch = docEpochVal;
    this.seenAudioInCurrentDoc = true;
    this.lastAudioSeq = seqVal;
    this.onAudioChunk?.(
      {
        kind: "audioChunk",
        browserSessionId: rec.browserSessionId,
        browserIncarnation: rec.browserIncarnation,
        profileEpoch: rec.profileEpoch,
        producerRun: rec.producerRun,
        subscriptionEpoch: rec.subscriptionEpoch,
        docEpoch: rec.docEpoch,
        audioSeq: rec.audioSeq as string,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        encoding: AUDIO_ENCODING_PCM16LE,
        data: rec.data,
      },
      credentials,
    );
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
    try {
      const unpacked = unpackBhjfFrame(data);
      header = unpacked.header;
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

    if (!this.audioAttachmentRetired) {
      if (this.lastKnownProducerRun !== header.producerRun) {
        if (this.lastKnownProducerRun !== null) {
          this.retireProducerRun(this.lastKnownProducerRun);
          this.onAudioReset?.();
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
        this.lastAudioSeq = 0n;
        this.lastAudioDocEpoch = 1n;
        this.retiredAudioDocEpoch = 0n;
        this.seenAudioInCurrentDoc = false;
      }
      this.currentProducerRun = header.producerRun;
    }
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
      this.pending = { data, socket, subscriptionEpoch, header };
    } else {
      this.decodeAndDrawFrame(data, socket, subscriptionEpoch, header);
    }
  }

  private async decodeAndDrawFrame(
    data: ArrayBuffer,
    originatingSocket: WebSocket,
    originatingSubEpoch: string,
    header: TargetFrameHeader,
  ): Promise<void> {
    this.isDecoding = true;
    const currentEpoch = ++this.decodeEpoch;
    const decodeStartMonoMs = this.nowMonoMs();

    let bitmap: ImageBitmap | null = null;
    let decodeSucceeded = false;
    try {
      // Unpack JPEG slice for decoding
      const unpacked = unpackBhjfFrame(data);
      const jpegBlob = new Blob([unpacked.jpegPayload as Uint8Array<ArrayBuffer>], {
        type: "image/jpeg",
      });

      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(jpegBlob);
      } else {
        // Fallback for non-browser/test environments without createImageBitmap
        bitmap = {
          width: header.width,
          height: header.height,
          close: () => {},
        } as unknown as ImageBitmap;
      }
      decodeSucceeded = true;
    } catch {
      decodeSucceeded = false;
      this.sendMediaControl(originatingSocket, {
        kind: "frameDiscarded",
        subscriptionEpoch: originatingSubEpoch,
        producerRun: header.producerRun,
        viewportEpoch: header.viewportEpoch,
        frameSeq: header.frameSeq,
        reason: "decodeFailed",
      });
    }

    try {
      // Re-check owner/epoch/privacy and originating socket fidelity
      const isStillValid =
        !this.isDisposed &&
        !this.isPrivacyActive &&
        this.isVisible &&
        currentEpoch === this.decodeEpoch &&
        this.mediaWs === originatingSocket &&
        this.currentCredentials?.subscriptionEpoch === originatingSubEpoch &&
        originatingSocket.readyState === WebSocket.OPEN &&
        !this.retiredProducerRuns.has(header.producerRun) &&
        (this.lastKnownProducerRun === null ||
          this.lastKnownProducerRun === header.producerRun);
      if (decodeSucceeded && bitmap && isStillValid) {
        this.drawBitmapToCanvas(bitmap, header);
        const decodeMs = this.sanitizeDecodeMs(
          this.nowMonoMs() - decodeStartMonoMs,
        );
        if (decodeMs !== null) {
          this.lastDecodeMs = decodeMs;
          this. decodeMsEwma =
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
            next.data,
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
   */
  private drawBitmapToCanvas(
    bitmap: ImageBitmap,
    header: TargetFrameHeader,
  ): void {
    if (!this.ctx) return;

    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;
    if (canvasW <= 0 || canvasH <= 0) return;

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

    // Letterbox: clear whole canvas to black
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw frame image
    try {
      this.ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
    } catch {
      // In non-canvas test environments drawImage might not be implemented
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
  }
  /**
   * Redraws the last cached frame (e.g. after canvas resize) maintaining aspect fit.
   */
  public redrawCachedFrame(): void {
    if (
      this.lastCachedBitmap &&
      this.lastFrameHeader &&
      !this.isPrivacyActive
    ) {
      this.drawBitmapToCanvas(this.lastCachedBitmap, this.lastFrameHeader);
    }
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
    this.resetAudioState();

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
}

/**
 * Fixtures for browser-adaptive-stream.browser.tsx: fake media/control sockets, real JPEG
 * synthesis (canvas.toBlob), BHJF frame builders and server text-message builders.
 */
import { packBhjfFrame } from "@/browser-host/frame-protocol.js";
import type {
  BrowserAudioChunk,
  StreamQualityEvent,
  StreamQualityTier,
} from "@/api/browser-host-types.js";
import type { ViewerAttachmentCredentials } from "@/api/browser-host-client.js";
import type { BrowserToolsProps } from "@/os/browser/browser-tools.js";
import type { BrowserTabRuntime } from "@/os/browser/browser-tab-types.js";

export const SESSION_ID = "12345678-1234-4234-8234-123456789abc";
export const INCARNATION = "abcdef01-2345-4678-8901-234567890abc";
export const RUN_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const RUN_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const AUDIO_RUN_1 = "cccccccc-3333-4333-8333-cccccccccccc";
export const AUDIO_RUN_2 = "dddddddd-4444-4444-8444-dddddddddddd";

/** Tier anchors of the server ladder (capture_tier.rs stages 0/2/5/8): fps, jpeg quality, scale. */
export const TIERS: ReadonlyArray<{
  tier: StreamQualityTier; fps: number; jpegQuality: number; scale: number;
}> = [
  { tier: "high", fps: 20, jpegQuality: 80, scale: 1 },
  { tier: "medium", fps: 10, jpegQuality: 65, scale: 1 },
  { tier: "low", fps: 6, jpegQuality: 60, scale: 0.75 },
  { tier: "constrained", fps: 2, jpegQuality: 55, scale: 0.5 },
];

export class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = 1;
  binaryType = "blob";
  bufferedAmount = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  constructor(public readonly url: string, public readonly protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.onclose?.(); }
  push(data: string | ArrayBuffer): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  /** Parsed JSON messages this client sent, optionally filtered by `kind`. */
  messages(kind?: string): Record<string, unknown>[] {
    const all = this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    return kind ? all.filter((m) => m.kind === kind) : all;
  }
}

export function creds(n: number): ViewerAttachmentCredentials {
  return {
    owner: { profileId: "profile-1", generation: 1 },
    browserSessionId: SESSION_ID,
    browserIncarnation: INCARNATION,
    profileEpoch: "1",
    viewerId: `viewer-${n}`,
    subscriptionEpoch: `sub-${n}`,
    mediaTicket: `t-${n}`,
    controlTicket: `ct-${n}`,
    mediaWsUrl: "ws://127.0.0.1:4801/api/browser/media",
    controlWsUrl: "ws://127.0.0.1:4801/api/browser/control",
    mediaSubprotocols: ["damhopper.browser.media.v1", `damhopper.ticket.t-${n}`],
    controlSubprotocols: ["damhopper.browser.control.v1", `damhopper.ticket.ct-${n}`],
  };
}

export interface FrameSpec {
  run: string;
  seq: number;
  epoch?: string;
  w: number;
  h: number;
  trusted: boolean;
  rgb: [number, number, number];
  jpegQuality?: number;
  css?: { w: number; h: number };
}

/** A BHJF binary media message carrying a real JPEG of the requested size/colour. */
export async function frameBytes(spec: FrameSpec): Promise<ArrayBuffer> {
  const c = document.createElement("canvas");
  c.width = spec.w;
  c.height = spec.h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = `rgb(${spec.rgb.join(",")})`;
  ctx.fillRect(0, 0, spec.w, spec.h);
  const { promise: blobPromise, resolve, reject } = Promise.withResolvers<Blob>();
  c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", (spec.jpegQuality ?? 80) / 100);
  const blob = await blobPromise;
  const css = spec.css ?? { w: 1280, h: 720 };
  const packed = packBhjfFrame(
    {
      browserSessionId: SESSION_ID,
      browserIncarnation: INCARNATION,
      profileEpoch: "1",
      producerRun: spec.run,
      viewportEpoch: spec.epoch ?? "1",
      frameSeq: String(spec.seq),
      width: spec.w,
      height: spec.h,
      captureTimeUnixMs: 1700000000000,
      geometry: {
        cssWidth: css.w, cssHeight: css.h, offsetTop: 0, scrollX: 0, scrollY: 0,
        pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1,
      },
      inputTrusted: spec.trusted,
    },
    new Uint8Array(await blob.arrayBuffer()),
  );
  return packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer;
}

export function qualityEvent(over: Partial<StreamQualityEvent> = {}): string {
  const event: StreamQualityEvent = {
    kind: "streamQuality", subscriptionEpoch: "sub-1", preference: "auto", producerRun: RUN_A,
    captureVersion: "1", sharedTier: "high", viewerTier: "high", fps: 20, jpegQuality: 80,
    scale: 1, imageWidth: 1280, imageHeight: 720, audioSuppressed: false, audioReason: null,
    status: "effective", ...over,
  };
  return JSON.stringify(event);
}

/** 50 ms of a non-silent 24 kHz PCM16 tone as a server audioChunk text message. */
export function audioChunk(audioRun: string, audioSeq: number): string {
  const pcm = new Int16Array(1200).map((_, i) => Math.round(8000 * Math.sin(i / 7)));
  const data = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
  const chunk: BrowserAudioChunk = {
    kind: "audioChunk", browserSessionId: SESSION_ID, browserIncarnation: INCARNATION, profileEpoch: "1",
    audioRun, subscriptionEpoch: "sub-1", docEpoch: "1", audioSeq: String(audioSeq),
    sampleRate: 24000, channels: 1, encoding: "pcm16le", data,
  };
  return JSON.stringify(chunk);
}

const liveTab: BrowserTabRuntime = {
  tabId: "t1", kind: "ordinary", title: "Synthetic", committedUrl: "https://example.test", phase: "live",
  sessionId: SESSION_ID, draft: { value: "https://example.test", dirty: false }, actionSequence: 1,
  snapshot: {
    browserSessionId: SESSION_ID, browserIncarnation: INCARNATION, profileEpoch: "1", navigationRevision: "1",
    viewportEpoch: "1", url: "https://example.test", title: "Synthetic", status: "running", inputAvailable: false,
    geometry: { cssWidth: 1280, cssHeight: 720, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
  },
};

/** BrowserTools props for a view-only viewer (no control lease, not a controller). */
export function viewOnlyToolsProps(over: Partial<BrowserToolsProps>): BrowserToolsProps {
  const noop = () => {};
  return {
    panelId: "adaptive-tools", windowId: "w1", owner: { profileId: "profile-1", generation: 1 },
    verifiedScope: { principal: "dev-user", namespace: "dev", profileId: "profile-1", endpoint: "http://127.0.0.1:4801" },
    activeTab: liveTab, privacyMasked: false, ownerMismatch: false, navigationError: null,
    selectionPending: false, selectionActive: false, controlPending: false, clearPending: false,
    clearStatus: null, onAcquireControl: noop, onReleaseControl: noop, onToggleSelection: noop,
    onClearRemembered: noop, onCloseTools: noop, onAttachSession: noop, onWindowStateUpdated: noop,
    ...over,
  };
}

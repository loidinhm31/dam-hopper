/**
 * Gapless 24 kHz mono PCM16LE player for Browser Host live tab audio.
 */

import { AUDIO_SAMPLE_RATE, MAX_AUDIO_BASE64_BYTES, MAX_AUDIO_PCM_BYTES } from "../api/browser-host-types.js";

export const PCM_SAMPLE_RATE = AUDIO_SAMPLE_RATE;
export const MAX_AUDIO_QUEUE_SECONDS = 0.5;
const INITIAL_SCHEDULE_LEAD_SECONDS = 0.02;
const MAX_PENDING_PCM_BYTES = Math.floor(PCM_SAMPLE_RATE * 2 * MAX_AUDIO_QUEUE_SECONDS);
const MAX_PENDING_AGE_MS = Math.floor(MAX_AUDIO_QUEUE_SECONDS * 1000);
const BASE64_CHUNK_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as Record<string, unknown>;
  const ctor = g.AudioContext ?? g.webkitAudioContext;
  return typeof ctor === "function" ? (ctor as typeof AudioContext) : null;
}

export interface PcmPlayerOptions { canPlay?: () => boolean; onAutoplayBlockedChange?: (blocked: boolean) => void; }
interface PendingChunk { samples: Int16Array; enqueuedAt: number; }

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private nextStartTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private pendingChunks: PendingChunk[] = [];
  private pendingBytes = 0;
  private resumePromise: Promise<void> | null = null;
  private gestureResumeInFlight = false;
  private resumeRejected = false;
  private playbackEpoch = 0;
  private autoplayBlocked = false;
  private disposed = false;
  private readonly canPlay?: () => boolean;
  private readonly onAutoplayBlockedChange?: (blocked: boolean) => void;

  public constructor(options?: PcmPlayerOptions) { this.canPlay = options?.canPlay; this.onAutoplayBlockedChange = options?.onAutoplayBlockedChange; }

  public prime(): void {
    if (this.disposed || (this.canPlay && !this.canPlay())) return;
    this.resumeRejected = false;
    const ctx = this.ensureContext(); if (!ctx) return;
    if (ctx.state === "running") { this.setAutoplayBlocked(false); this.drainPending(ctx); return; }
    this.requestResume(ctx, true);
  }

  public enqueue(base64Pcm16: string): void {
    if (this.disposed || !base64Pcm16 || base64Pcm16.length > MAX_AUDIO_BASE64_BYTES) return;
    if (this.canPlay && !this.canPlay()) { this.flush(); return; }
    const samples = this.decodePcm16Le(base64Pcm16);
    if (!samples || samples.length === 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (this.queuedSeconds() + samples.length / PCM_SAMPLE_RATE > MAX_AUDIO_QUEUE_SECONDS) this.flush();

    if (ctx.state !== "running") {
      this.setAutoplayBlocked(true);
      const byteLength = samples.byteLength;
      if (byteLength > MAX_PENDING_PCM_BYTES) return;
      const now = Date.now();
      this.evictAgedPending(now);
      while (this.pendingBytes + byteLength > MAX_PENDING_PCM_BYTES && this.pendingChunks.length > 0) {
        this.pendingBytes -= this.pendingChunks.shift()!.samples.byteLength;
      }
      this.pendingChunks.push({ samples, enqueuedAt: now });
      this.pendingBytes += byteLength;
      this.requestResume(ctx, false);
      return;
    }
    this.setAutoplayBlocked(false);
    this.drainPending(ctx);
    this.scheduleSamples(ctx, samples);
  }

  public flush(): void {
    this.playbackEpoch++;
    this.pendingChunks = [];
    this.pendingBytes = 0;
    if (this.masterGain && this.ctx) {
      try { this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime); this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime); } catch { /* ignore */ }
    }
    for (const src of this.sources) {
      try { src.onended = null; src.stop(0); } catch { /* ignore */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.sources.clear();
    if (this.masterGain) { try { this.masterGain.disconnect(); } catch { /* ignore */ } this.masterGain = null; }
    this.nextStartTime = this.ctx ? this.ctx.currentTime : 0;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.flush(); this.resumePromise = null; this.gestureResumeInFlight = false; this.setAutoplayBlocked(false);
    const ctx = this.ctx; this.ctx = null;
    if (ctx) { try { void ctx.close().catch(() => {}); } catch { /* ignore */ } }
  }

  public queuedSeconds(): number {
    const scheduled = this.ctx ? Math.max(0, this.nextStartTime - this.ctx.currentTime) : 0;
    return scheduled + this.pendingBytes / (PCM_SAMPLE_RATE * 2);
  }

  public isAutoplayBlocked(): boolean { return this.autoplayBlocked; }

  private setAutoplayBlocked(blocked: boolean): void {
    if (this.autoplayBlocked !== blocked) { this.autoplayBlocked = blocked; this.onAutoplayBlockedChange?.(blocked); }
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (!this.ctx || this.ctx.state === "closed") {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) return null;
      try { this.ctx = new Ctor({ sampleRate: PCM_SAMPLE_RATE }); } catch { return null; }
      this.nextStartTime = 0; this.masterGain = null; this.resumePromise = null; this.gestureResumeInFlight = false; this.resumeRejected = false;
    }
    this.ensureMasterGain(this.ctx);
    return this.ctx;
  }

  private ensureMasterGain(ctx: AudioContext): GainNode {
    if (!this.masterGain) {
      const gain = ctx.createGain(); gain.gain.value = 1; gain.connect(ctx.destination); this.masterGain = gain;
    }
    return this.masterGain;
  }

  private requestResume(ctx: AudioContext, fromGesture: boolean): void {
    if (fromGesture ? this.gestureResumeInFlight : (this.resumePromise !== null || this.resumeRejected)) return;
    if (fromGesture) this.gestureResumeInFlight = true;
    const epoch = this.playbackEpoch;
    const p = ctx.resume().then(
      () => {
        if (this.resumePromise === p) this.resumePromise = null;
        if (fromGesture) this.gestureResumeInFlight = false;
        if (this.disposed || this.ctx !== ctx) return;
        if (ctx.state === "running") { this.resumeRejected = false; this.setAutoplayBlocked(false); }
        if (epoch !== this.playbackEpoch) return;
        if (this.canPlay && !this.canPlay()) { this.flush(); return; }
        if (ctx.state === "running") this.drainPending(ctx);
      },
      () => {
        if (this.resumePromise === p) this.resumePromise = null;
        if (fromGesture) this.gestureResumeInFlight = false;
        this.resumeRejected = true;
        this.pendingChunks = []; this.pendingBytes = 0;
        if (!this.disposed && this.ctx === ctx) this.setAutoplayBlocked(true);
      },
    );
    if (!this.resumePromise) this.resumePromise = p;
  }

  private evictAgedPending(now: number): void {
    while (this.pendingChunks.length > 0 && now - this.pendingChunks[0].enqueuedAt > MAX_PENDING_AGE_MS) {
      this.pendingBytes -= this.pendingChunks.shift()!.samples.byteLength;
    }
  }

  private drainPending(ctx: AudioContext): void {
    this.evictAgedPending(Date.now());
    if (this.pendingChunks.length === 0) return;
    const chunks = this.pendingChunks.splice(0, this.pendingChunks.length);
    this.pendingBytes = 0;
    for (const item of chunks) this.scheduleSamples(ctx, item.samples);
  }

  private scheduleSamples(ctx: AudioContext, samples: Int16Array): void {
    if (this.disposed || (this.canPlay && !this.canPlay())) return;
    const gain = this.ensureMasterGain(ctx);
    const float32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) float32[i] = samples[i] / 32768;
    const buffer = ctx.createBuffer(1, float32.length, PCM_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.connect(gain);
    const startAt = Math.max(ctx.currentTime + INITIAL_SCHEDULE_LEAD_SECONDS, this.nextStartTime);
    src.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => { this.sources.delete(src); try { src.disconnect(); } catch { /* ignore */ } };
  }

  private decodePcm16Le(base64Pcm16: string): Int16Array | null {
    if (base64Pcm16.length % 4 !== 0 || !BASE64_CHUNK_PATTERN.test(base64Pcm16)) return null;
    let bin: string;
    try { bin = atob(base64Pcm16); } catch { return null; }
    const byteLen = bin.length;
    if (byteLen === 0 || (byteLen & 1) !== 0 || byteLen > MAX_AUDIO_PCM_BYTES) return null;
    const out = new Int16Array(byteLen >> 1);
    for (let i = 0, j = 0; i < byteLen; i += 2, j++) {
      const u16 = (bin.charCodeAt(i) & 0xff) | ((bin.charCodeAt(i + 1) & 0xff) << 8);
      out[j] = u16 >= 0x8000 ? u16 - 0x10000 : u16;
    }
    return out;
  }
}

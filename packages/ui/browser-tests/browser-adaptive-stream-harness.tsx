/**
 * Harness for browser-adaptive-stream.browser.tsx: a real BrowserStreamController drawing on a real
 * CanvasView canvas, a real BrowserInputController reading the controller's drawn rect, fake media and
 * control sockets, and pixel/pointer helpers that observe behaviour instead of internal state.
 */
import { act, useCallback, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { vi, expect } from "vitest";
import { CanvasView } from "@/browser-host/canvas-view.js";
import { BrowserInputController } from "@/browser-host/input-controller.js";
import { TextInputProxy } from "@/browser-host/text-input-proxy.js";
import { PcmPlayer } from "@/browser-host/pcm-player.js";
import { BrowserStreamController } from "@/browser-host/stream-controller.js";
import { BrowserTools } from "@/os/browser/browser-tools.js";
import {
  clearStreamQuality, getStreamQuality, publishStreamQuality, setQualityPreference, subscribeStreamQuality,
  type StreamQualityTuple,
} from "@/os/browser/browser-stream-quality.js";
import {
  INCARNATION, MockWebSocket, RUN_A, SESSION_ID, creds, frameBytes, viewOnlyToolsProps, type FrameSpec,
} from "./browser-adaptive-stream-fixtures.js";
import "@/index.css";

export type Rgb = [number, number, number];
export const RED: Rgb = [255, 0, 0], GREEN: Rgb = [0, 200, 0], BLUE: Rgb = [0, 0, 255], YELLOW: Rgb = [255, 200, 0];
export const T1: StreamQualityTuple = { profileId: "profile-1", generation: 1, windowId: "w1", tabId: "t1" };

export interface Viewer {
  controller: BrowserStreamController; input: BrowserInputController; canvas: HTMLCanvasElement;
  /** The real TextInputProxy textarea (IME composition / paste entry), bound to `input`. */
  textarea: HTMLTextAreaElement;
  media: MockWebSocket; control: MockWebSocket; player: PcmPlayer;
  audio: { muted: boolean; chunks: number; resets: number }; epoch: { value: string };
}
export interface Box { x0: number; x1: number; y0: number; y1: number }
export interface InputEv { kind: string; u: number; v: number }
export interface Pt { clientX: number; clientY: number }

let cleanups: Array<() => void> = [];
let seq = 0;
export const onCleanup = (fn: () => void) => { cleanups.push(fn); };
export function resetHarness(): void { seq = 0; MockWebSocket.instances = []; vi.stubGlobal("WebSocket", MockWebSocket); }
export function disposeHarness(): void { cleanups.splice(0).reverse().forEach((c) => c()); vi.unstubAllGlobals(); }

export async function mountViewer(): Promise<Viewer> {
  const container = document.createElement("div");
  container.style.cssText = "width:640px;height:480px;position:relative";
  document.body.append(container);
  const root = createRoot(container);
  let canvas: HTMLCanvasElement | null = null;
  let input!: BrowserInputController;
  const render = (ctl: BrowserInputController | null) => act(async () => {
    root.render(
      <CanvasView ref={(n) => { canvas = n; }} controller={null}
        onCanvasPointerDown={(e) => input.handlePointerDown(e)} onCanvasPointerUp={(e) => input.handlePointerUp(e)}
        onCanvasPointerMove={(e) => input.handlePointerMove(e)} onCanvasWheel={(e) => input.handleWheel(e)}>
        <TextInputProxy controller={ctl} />
      </CanvasView>,
    );
  });
  await render(null);
  await vi.waitFor(() => expect(canvas).not.toBeNull());
  const audio = { muted: false, chunks: 0, resets: 0 };
  const epoch = { value: "1" };
  const player = new PcmPlayer({ canPlay: () => !audio.muted });
  const controller = new BrowserStreamController({
    canvas: canvas!,
    onStreamQuality: (e) => publishStreamQuality(T1, e),
    onStreamQualityReset: () => clearStreamQuality(T1),
    onAudioChunk: (c) => { audio.chunks++; player.enqueue(c.data); },
    onAudioReset: () => { audio.resets++; player.flush(); },
  });
  input = new BrowserInputController({
    getSessionId: () => SESSION_ID, getIncarnation: () => INCARNATION, getProfileEpoch: () => "1",
    getSubscriptionEpoch: () => controller.getCurrentSubscriptionEpoch(), getLeaseToken: () => "lease-1",
    getViewportEpoch: () => epoch.value, getDrawnRect: () => controller.getDrawnRect(),
    getControlSocket: () => controller.getControlSocket(),
  });
  await render(input);
  controller.attach(creds(1));
  const [media, control] = MockWebSocket.instances.slice(-2);
  media.onopen?.();
  audio.resets = 0; // attach() flushes the player once; scenarios count from a clean slate
  onCleanup(() => { controller.dispose(); player.dispose(); input.dispose(); act(() => root.unmount()); container.remove(); });
  return { controller, input, canvas: canvas!, textarea: container.querySelector<HTMLTextAreaElement>("textarea")!, media, control, player, audio, epoch };
}

/** Pushes a real BHJF frame; resolves to its frameSeq. */
export async function feed(v: Viewer, over: Partial<FrameSpec> & Pick<FrameSpec, "rgb">): Promise<number> {
  const spec: FrameSpec = { run: RUN_A, seq: ++seq, w: 1280, h: 720, trusted: true, ...over };
  v.media.push(await frameBytes(spec));
  return spec.seq;
}
export function nextSeq(): number { return ++seq; }
const feedback = (v: Viewer, n: number): string | undefined => {
  const m = v.media.messages().find((x) => (x.kind === "frameAck" || x.kind === "frameDiscarded") && x.frameSeq === String(n));
  return m && (m.kind === "frameAck" ? "ack" : String(m.reason));
};
/** The viewer's verdict on frame `n`: "ack" (painted) or the frameDiscarded reason. */
export async function outcome(v: Viewer, n: number): Promise<string> {
  await vi.waitFor(() => expect(feedback(v, n)).toBeDefined(), { timeout: 5000 });
  return feedback(v, n)!;
}
export async function drawn(v: Viewer, over: Partial<FrameSpec> & Pick<FrameSpec, "rgb">): Promise<string> {
  return outcome(v, await feed(v, over));
}

export const inputEvents = (v: Viewer) => v.control.messages().map((m) => m.event as InputEv);
export const pixel = (v: Viewer, x: number, y: number) =>
  Array.from(v.canvas.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3));
export const isColor = (p: number[], rgb: Rgb) => p.every((c, i) => Math.abs(c - rgb[i]) < 50);
export const centerIs = (v: Viewer, rgb: Rgb) => isColor(pixel(v, v.canvas.width >> 1, v.canvas.height >> 1), rgb);

/** Bounding box (canvas px) of the lit image along the centre row/column: an independent oracle. */
export function paintedBox(c: HTMLCanvasElement): Box {
  const { data, width, height } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  const lit = (x: number, y: number) => data[(y * width + x) * 4] + data[(y * width + x) * 4 + 1] + data[(y * width + x) * 4 + 2] > 150;
  const cx = width >> 1, cy = height >> 1;
  let [x0, x1, y0, y1] = [cx, cx, cy, cy];
  while (x0 > 0 && lit(x0 - 1, cy)) x0--;
  while (x1 < width - 1 && lit(x1 + 1, cy)) x1++;
  while (y0 > 0 && lit(cx, y0 - 1)) y0--;
  while (y1 < height - 1 && lit(cx, y1 + 1)) y1++;
  return { x0, x1, y0, y1 };
}
/** Client point at image fractions (fu, fv) of the painted box (fractions may fall outside it). */
export function at(v: Viewer, box: Box, fu: number, fv: number): Pt {
  const r = v.canvas.getBoundingClientRect(), k = r.width / v.canvas.width;
  return { clientX: r.left + (box.x0 + fu * (box.x1 - box.x0 + 1)) * k, clientY: r.top + (box.y0 + fv * (box.y1 - box.y0 + 1)) * k };
}
export const center = (v: Viewer): Pt => at(v, paintedBox(v.canvas), 0.5, 0.5);
export function fire(v: Viewer, type: string, pt: Pt): void {
  v.canvas.dispatchEvent(type === "wheel"
    ? new WheelEvent(type, { ...pt, deltaY: 120, bubbles: true })
    : new PointerEvent(type, { ...pt, button: 0, bubbles: true }));
}
export function click(v: Viewer, pt: Pt): void { fire(v, "pointerdown", pt); fire(v, "pointerup", pt); }
export const settle = () => new Promise((r) => setTimeout(r, 80));
export const pointerDowns = (v: Viewer) => inputEvents(v).filter((e) => e.kind === "pointerDown").length;

function QualityPanel({ tuple }: { tuple: StreamQualityTuple }) {
  const state = useSyncExternalStore(
    useCallback((n) => subscribeStreamQuality(tuple, n), [tuple]),
    useCallback(() => getStreamQuality(tuple), [tuple]),
  );
  return (
    <BrowserTools {...viewOnlyToolsProps({
      qualityPreference: state.preference, qualityStatus: state.status, qualityPending: state.pending,
      onQualityPreferenceChange: (p) => setQualityPreference(tuple, p),
    })} />
  );
}
/** Real BrowserTools bound to the in-memory quality store exactly like BrowserApp binds it. */
export async function mountPanel(tuple: StreamQualityTuple) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  onCleanup(() => { act(() => root.unmount()); container.remove(); });
  const render = (t: StreamQualityTuple) => act(async () => root.render(<QualityPanel tuple={t} />));
  await render(tuple);
  const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { render, q, select: () => q("browser-quality-selector") as HTMLSelectElement };
}
export const storageSnapshot = async () =>
  JSON.stringify([{ ...localStorage }, { ...sessionStorage }, (await indexedDB.databases()).map((d) => d.name)]);
export const compact = (el: HTMLElement | null) => (el?.textContent ?? "").replace(/\s+/g, "");

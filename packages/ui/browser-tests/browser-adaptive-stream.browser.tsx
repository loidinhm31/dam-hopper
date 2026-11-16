import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  clearAllStreamQualityForTesting, getQualityPreference, releaseWindow, subscribeStreamQuality,
  type StreamQualityTuple,
} from "@/os/browser/browser-stream-quality.js";
import {
  AUDIO_RUN_1, AUDIO_RUN_2, MockWebSocket, RUN_A, RUN_B, TIERS, audioChunk, creds, frameBytes, qualityEvent,
} from "./browser-adaptive-stream-fixtures.js";
import {
  BLUE, GREEN, RED, T1, YELLOW, at, center, centerIs, click, compact, disposeHarness, drawn, fire, inputEvents,
  isColor, mountPanel, mountViewer, nextSeq, onCleanup, outcome, paintedBox, pixel, pointerDowns, resetHarness,
  settle, storageSnapshot,
} from "./browser-adaptive-stream-harness.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T2: StreamQualityTuple = { ...T1, windowId: "w2" };
const T1_GEN2: StreamQualityTuple = { ...T1, generation: 2 };

beforeEach(resetHarness);
afterEach(() => { disposeHarness(); clearAllStreamQualityForTesting(); });

describe("adaptive stream: real controller + canvas + input in Chromium", () => {
  it("draws every tier's scale/quality and maps CSS-pixel input to identical image fractions", async () => {
    const v = await mountViewer();
    const points: Array<[number, number]> = [[0.5, 0.5], [0.02, 0.02], [0.98, 0.98]];
    const palette = [RED, GREEN, BLUE, YELLOW];
    let n = 0;
    for (const base of [{ w: 1280, h: 720 }, { w: 1366, h: 768 }]) {
      for (const t of TIERS) {
        const [w, h, rgb] = [Math.round(base.w * t.scale), Math.round(base.h * t.scale), palette[n++ % 4]];
        expect(await drawn(v, { w, h, rgb, jpegQuality: t.jpegQuality, css: { w: base.w, h: base.h } })).toBe("ack");
        expect(centerIs(v, rgb)).toBe(true);
        expect(isColor(pixel(v, v.canvas.width >> 1, 3), [0, 0, 0])).toBe(true); // letterbox stays black
        expect(v.controller.getDrawnRect()).toMatchObject({ imageWidth: w, imageHeight: h, inputTrusted: true });
        const box = paintedBox(v.canvas);
        expect(Math.abs((box.x1 - box.x0 + 1) / (box.y1 - box.y0 + 1) - w / h)).toBeLessThan(0.05);
        const before = inputEvents(v).length;
        for (const [fu, fv] of points) click(v, at(v, box, fu, fv));
        const downs = inputEvents(v).slice(before).filter((e) => e.kind === "pointerDown");
        expect(downs).toHaveLength(3);
        downs.forEach((e, i) => {
          expect(Math.abs(e.u - points[i][0])).toBeLessThan(0.01);
          expect(Math.abs(e.v - points[i][1])).toBeLessThan(0.01);
        });
        const downsBefore = pointerDowns(v);
        click(v, at(v, box, 0.5, -6 / (box.y1 - box.y0 + 1))); // inside the letterbox bar
        expect(pointerDowns(v)).toBe(downsBefore);
      }
    }
  });

  it("production-shaped trust: downscaled frames paint display-only, scale 1000 frames drive input", async () => {
    for (const t of TIERS) {
      const v = await mountViewer();
      const trusted = t.scale === 1;
      const [w, h] = [Math.round(1280 * t.scale), Math.round(720 * t.scale)];
      expect(await drawn(v, { w, h, rgb: GREEN, trusted, jpegQuality: t.jpegQuality })).toBe("ack");
      expect(centerIs(v, GREEN)).toBe(true); // always visible
      const pt = center(v);
      fire(v, "pointerdown", pt); fire(v, "pointermove", pt); fire(v, "pointerup", pt); fire(v, "wheel", pt);
      await settle();
      const kinds = inputEvents(v).map((e) => e.kind);
      if (trusted) {
        expect(kinds).toEqual(expect.arrayContaining(["pointerDown", "pointerMove", "pointerUp", "wheel"]));
        v.input.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", code: "Enter" }));
        expect(inputEvents(v).map((e) => e.kind)).toContain("keyDown");
      } else {
        expect(kinds.filter((k) => k !== "pointerUp")).toEqual([]);
      }
    }
  });

  it("late old-run or older-epoch frames never repaint nor re-grant input trust (SI-09/SI-10)", async () => {
    const v = await mountViewer();
    expect(await drawn(v, { run: RUN_A, rgb: GREEN })).toBe("ack");
    click(v, center(v));
    expect(pointerDowns(v)).toBe(1);

    // Tier switch: new run B (downscaled, untrusted).
    expect(await drawn(v, { run: RUN_B, rgb: RED, w: 960, h: 540, trusted: false })).toBe("ack");
    expect(v.controller.getDrawnRect()).toMatchObject({ imageWidth: 960, inputTrusted: false });
    // Late frame of retired run A claims trust: discarded, no paint, no trust.
    expect(await drawn(v, { run: RUN_A, rgb: BLUE })).toBe("obsolete");
    expect(centerIs(v, RED)).toBe(true);
    expect(v.controller.getDrawnRect()).toMatchObject({ imageWidth: 960, inputTrusted: false });
    click(v, center(v));
    expect(pointerDowns(v)).toBe(1);

    // Same run, canonical epoch 2 trusted frame: input also needs the viewer's canonical epoch to match.
    expect(await drawn(v, { run: RUN_B, rgb: YELLOW, epoch: "2" })).toBe("ack");
    click(v, center(v));
    expect(pointerDowns(v)).toBe(1); // viewer snapshot still epoch 1
    v.epoch.value = "2";
    click(v, center(v));
    expect(pointerDowns(v)).toBe(2);
    // Epoch 3 untrusted lands, then a late trusted epoch-2 frame must be discarded.
    expect(await drawn(v, { run: RUN_B, rgb: RED, epoch: "3", trusted: false })).toBe("ack");
    v.epoch.value = "3";
    expect(await drawn(v, { run: RUN_B, rgb: BLUE, epoch: "2" })).toBe("obsolete");
    expect(centerIs(v, RED)).toBe(true);
    click(v, center(v));
    expect(pointerDowns(v)).toBe(2);
  });

  it("an in-flight decode of the old run is discarded when the new run's frame arrives", async () => {
    const v = await mountViewer();
    const [a, b] = [nextSeq(), nextSeq()];
    const bytesA = await frameBytes({ run: RUN_A, seq: a, w: 1280, h: 720, trusted: true, rgb: BLUE });
    const bytesB = await frameBytes({ run: RUN_B, seq: b, w: 960, h: 540, trusted: false, rgb: RED });
    v.media.push(bytesA); // decode starts
    v.media.push(bytesB); // arrives while A decodes: retires A
    expect(await outcome(v, a)).toBe("obsolete");
    expect(await outcome(v, b)).toBe("ack");
    expect(centerIs(v, RED)).toBe(true);
    expect(v.controller.getDrawnRect()).toMatchObject({ imageWidth: 960, inputTrusted: false });
  });

  // Untrusted frames are display-only for every input entry point (pointer, wheel, key, text/IME/paste).
  const key = (type: "keydown" | "keyup", k: string) => new KeyboardEvent(type, { key: k, code: k });

  it("untrusted frame blocks keyboard, text, composition and paste input", async () => {
    const v = await mountViewer();
    expect(await drawn(v, { rgb: GREEN, w: 960, h: 540, trusted: false })).toBe("ack");
    expect(v.input.handleKeyDown(key("keydown", "Enter"))).toBe(false);
    expect(v.input.handleKeyUp(key("keyup", "Enter"))).toBe(false);
    expect(v.input.handleInsertText("x")).toBe(false); // TextInputProxy routes input/composition/paste here
    expect(v.input.handlePointerCancel()).toBe(false);
    await settle();
    expect(inputEvents(v)).toEqual([]);
    // Trusted frame restores input.
    expect(await drawn(v, { rgb: RED })).toBe("ack");
    expect(v.input.handleKeyDown(key("keydown", "Enter"))).toBe(true);
    expect(v.input.handleInsertText("x")).toBe(true);
    expect(inputEvents(v).map((e) => e.kind)).toEqual(["keyDown", "insertText"]);
  });

  it("untrusted frame blocks wheel that falls back to stale pointer coordinates", async () => {
    const v = await mountViewer();
    expect(await drawn(v, { rgb: GREEN })).toBe("ack");
    const pt = center(v);
    fire(v, "pointermove", pt);
    await settle();
    expect(await drawn(v, { rgb: RED, w: 960, h: 540, trusted: false })).toBe("ack");
    const before = inputEvents(v).length;
    fire(v, "wheel", pt);
    await settle();
    expect(inputEvents(v).slice(before)).toEqual([]);
    // Restored trust must not reuse the pre-downscale pointer position either.
    expect(await drawn(v, { rgb: BLUE })).toBe("ack");
    fire(v, "wheel", { clientX: -50, clientY: -50 });
    await settle();
    expect(inputEvents(v).slice(before)).toEqual([]);
  });

  it("trusted -> untrusted releases held keys/buttons with paired keyUp/pointerCancel and sends nothing else", async () => {
    const v = await mountViewer();
    expect(await drawn(v, { rgb: GREEN })).toBe("ack");
    fire(v, "pointerdown", center(v));
    v.input.handleKeyDown(key("keydown", "Enter"));
    expect(v.input.getHeldKeys().size).toBe(1);
    expect(v.input.getHeldButtons().size).toBe(1);
    const before = inputEvents(v).length;
    expect(await drawn(v, { rgb: RED, w: 960, h: 540, trusted: false })).toBe("ack");
    // Physical key-up on the focused proxy while untrusted: no stuck key, only the paired release.
    expect(v.input.handleKeyUp(key("keyup", "Enter"))).toBe(false);
    v.input.handleKeyDown(key("keydown", "Tab"));
    v.input.handleInsertText("y");
    await settle();
    expect(inputEvents(v).slice(before).map((e) => e.kind)).toEqual(["keyUp", "pointerCancel"]);
    expect(v.input.getHeldKeys().size).toBe(0);
    expect(v.input.getHeldButtons().size).toBe(0);
  });

  const paste = (text: string) => {
    const e = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e, "clipboardData", { value: { getData: (f: string) => (f === "text/plain" ? text : "") } });
    return e;
  };

  it("IME composition committed after the frame turned untrusted sends nothing; works again once trusted", async () => {
    const v = await mountViewer();
    expect(await drawn(v, { rgb: GREEN })).toBe("ack");
    v.textarea.focus();
    v.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // Frame is downscaled (display-only) while the composition is in flight.
    expect(await drawn(v, { rgb: RED, w: 960, h: 540, trusted: false })).toBe("ack");
    v.textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "tiếng Việt" }));
    await settle();
    expect(inputEvents(v)).toEqual([]);
    expect(await drawn(v, { rgb: BLUE })).toBe("ack");
    v.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    v.textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本語" }));
    await settle();
    expect(v.control.messages().map((m) => m.event)).toEqual([{ kind: "insertText", text: "日本語" }]);
  });

  it("paste while untrusted sends nothing; paste after trust returns is inserted once", async () => {
    const v = await mountViewer();
    expect(await drawn(v, { rgb: GREEN, w: 960, h: 540, trusted: false })).toBe("ack");
    v.textarea.focus();
    v.textarea.dispatchEvent(paste("blocked-paste"));
    await settle();
    expect(inputEvents(v)).toEqual([]);
    expect(await drawn(v, { rgb: RED })).toBe("ack");
    v.textarea.dispatchEvent(paste("allowed-paste"));
    await settle();
    expect(v.control.messages().map((m) => m.event)).toEqual([{ kind: "insertText", text: "allowed-paste" }]);
  });
});

describe("adaptive stream: quality selector contract in real DOM", () => {
  it("view-only selector sends qualityPreference on the media socket and shows the shared tier truthfully", async () => {
    const storageBefore = await storageSnapshot();
    const v = await mountViewer();
    const ui = await mountPanel(T1);
    onCleanup(subscribeStreamQuality(T1, () => v.controller.setQualityPreference(getQualityPreference(T1))));
    expect(ui.select().disabled).toBe(false);
    expect(ui.select().value).toBe("auto");

    await userEvent.selectOptions(ui.select(), "low");
    await vi.waitFor(() => expect(v.media.messages("qualityPreference").at(-1)).toEqual(
      { kind: "qualityPreference", subscriptionEpoch: "sub-1", preference: "low" }), { timeout: 3000 });
    expect(ui.q("browser-quality-pending")).not.toBeNull();

    for (const [i, t] of TIERS.entries()) {
      const [w, h] = [Math.round(1280 * t.scale), Math.round(720 * t.scale)];
      v.media.push(qualityEvent({
        captureVersion: String(i + 1), preference: "low", sharedTier: t.tier, viewerTier: t.tier,
        fps: t.fps, jpegQuality: t.jpegQuality, scale: t.scale, imageWidth: w, imageHeight: h,
      }));
      await vi.waitFor(() => expect(ui.q("browser-quality-shared-tier")?.textContent).toBe(t.tier));
      expect(compact(ui.q("browser-quality-scale-jpeg"))).toContain(`${w}×${h}(${Math.round(t.scale * 100)}%,q${t.jpegQuality})`);
      expect(compact(ui.q("browser-quality-fps"))).toBe(`FPS:${t.fps}`);
      expect(ui.q("browser-quality-pending")).toBeNull();
      expect(ui.q("browser-quality-shared-limit-note") !== null).toBe(t.tier !== "low"); // pref low vs shared tier
    }
    // Tier switch rotates the video run; a late event of the retired run must not change the display.
    expect(await drawn(v, { run: RUN_A, rgb: GREEN })).toBe("ack");
    expect(await drawn(v, { run: RUN_B, rgb: RED, w: 640, h: 360, trusted: false })).toBe("ack");
    v.media.push(qualityEvent({ producerRun: RUN_A, captureVersion: "99", sharedTier: "high", viewerTier: "high" }));
    await settle();
    expect(ui.q("browser-quality-shared-tier")?.textContent).toBe("constrained");
    expect(v.control.sent).toEqual([]); // pure viewer: no lease / control traffic at all

    // Reconnect: fresh sockets re-announce the retained preference; stale diagnostics are cleared.
    v.controller.attach(creds(2));
    const media2 = MockWebSocket.instances.at(-2)!;
    media2.onopen?.();
    expect(media2.messages("qualityPreference")).toEqual([{ kind: "qualityPreference", subscriptionEpoch: "sub-2", preference: "low" }]);
    await vi.waitFor(() => expect(ui.q("browser-quality-diagnostics")).toBeNull());
    expect(ui.select().value).toBe("low");

    expect(await storageSnapshot()).toBe(storageBefore); // session-only: nothing persisted
  });

  it("preference is keyed by (profile, generation, window, tab) and released with its window", async () => {
    const ui = await mountPanel(T1);
    await userEvent.selectOptions(ui.select(), "high");
    expect(ui.select().value).toBe("high");
    await ui.render(T2);
    expect(ui.select().value).toBe("auto");
    await ui.render(T1_GEN2);
    expect(ui.select().value).toBe("auto");
    await ui.render(T1); // window re-placed/remounted: preference survives
    expect(ui.select().value).toBe("high");
    act(() => releaseWindow("w1")); // window closed
    await vi.waitFor(() => expect(ui.select().value).toBe("auto"));
    expect(getQualityPreference(T1)).toBe("auto");
  });
});

describe("adaptive stream: audio identity across video tier switches", () => {
  it("keeps the audio source across a video producerRun rotation, resets on audioRun change, silences on mute", async () => {
    const v = await mountViewer();
    v.controller.setAudioMuted(false);
    const lastMute = () => v.media.messages("muteState").at(-1);
    v.media.push(audioChunk(AUDIO_RUN_1, 1));
    expect(v.audio.chunks).toBe(1);
    expect(v.player.queuedSeconds()).toBeGreaterThan(0);

    // Video-only tier switch: producerRun A -> B, audioRun untouched.
    expect(await drawn(v, { run: RUN_A, rgb: GREEN })).toBe("ack");
    expect(await drawn(v, { run: RUN_B, rgb: RED, w: 960, h: 540, trusted: false })).toBe("ack");
    v.media.push(audioChunk(AUDIO_RUN_1, 2));
    expect(v.audio.chunks).toBe(2);
    expect(v.audio.resets).toBe(0);
    expect(v.player.queuedSeconds()).toBeGreaterThan(0);

    // New audioRun is a new source: reset once, then plays; the retired audioRun is rejected.
    v.media.push(audioChunk(AUDIO_RUN_2, 1));
    expect([v.audio.chunks, v.audio.resets]).toEqual([3, 1]);
    v.media.push(audioChunk(AUDIO_RUN_1, 3));
    expect([v.audio.chunks, v.audio.resets]).toEqual([3, 1]);

    // Mute: local silence is synchronous, server is told, later audio is not queued; unmute resumes.
    v.audio.muted = true;
    v.controller.setAudioMuted(true);
    expect(v.player.queuedSeconds()).toBe(0);
    expect(lastMute()).toEqual({ kind: "muteState", subscriptionEpoch: "sub-1", muted: true });
    v.media.push(audioChunk(AUDIO_RUN_2, 2));
    expect(v.player.queuedSeconds()).toBe(0);
    v.audio.muted = false;
    v.controller.setAudioMuted(false);
    await vi.waitFor(() => expect(lastMute()).toEqual({ kind: "muteState", subscriptionEpoch: "sub-1", muted: false }), { timeout: 3000 });
    v.media.push(audioChunk(AUDIO_RUN_2, 3));
    expect(v.player.queuedSeconds()).toBeGreaterThan(0);
  });
});

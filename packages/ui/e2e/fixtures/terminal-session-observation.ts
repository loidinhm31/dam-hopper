import type { Page, WebSocket } from "@playwright/test";
import { expect } from "@playwright/test";

export interface TerminalWsFrame {
  kind: string;
  id?: string;
  direction: "sent" | "received";
  timestamp: number;
  socketIndex: number;
  offset?: number;
  incarnation?: number | string;
  dataLength?: number;
}

export interface ClientDiagnosticItem {
  id: string;
  type: string;
  scope: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface TerminalObservationSnapshot {
  sessionId: string;
  token: string;
  createdCount: number;
  disposeCount: number;
  wsAttachCount: number;
  diagnosticAttachCount: number;
  attachCount: number;
  wsReplayCount: number;
  diagnosticReplayCount: number;
  replayCount: number;
  resetCount: number;
  outputCount: number;
  outputBytes: number;
  lastOutputOffset: number;
  backendEpoch: string | null;
  incarnation: number | string | null;
  timestamp: number;
}

export interface ObserverPositiveControls {
  expectCreationDetected: boolean;
  expectAttachDetected: boolean;
  expectReplayDetected: boolean;
}

/**
 * Terminal session observation fixture.
 * Reads both WebSocket frames (sent & received) and client-side diagnostic storage
 * (localStorage["damhopper_diagnostics_frontend_v1"]).
 *
 * Enforces fail-closed validation: missing data or empty baselines are treated as
 * failures, never silently assumed zero.
 */
export class TerminalSessionObserver {
  private static readonly MAX_FRAMES = 5000;
  private totalFramesRecorded = 0;
  private wsFrames: TerminalWsFrame[] = [];
  private sockets: WebSocket[] = [];
  private attached = false;
  constructor(public readonly page: Page) {
    this.attachListeners();
  }

  private attachListeners(): void {
    if (this.attached) return;
    this.attached = true;

    this.page.on("websocket", (ws) => {
      this.sockets.push(ws);

      ws.on("framesent", (event) => {
        try {
          const payloadStr = typeof event.payload === "string" ? event.payload : event.payload.toString("utf8");
          const parsed = JSON.parse(payloadStr);
          if (parsed && typeof parsed.kind === "string" && parsed.kind.startsWith("terminal:")) {
            this.totalFramesRecorded++;
            const socketIndex = this.sockets.indexOf(ws);
            if (this.wsFrames.length >= TerminalSessionObserver.MAX_FRAMES) {
              this.wsFrames.shift();
            }
            this.wsFrames.push({
              kind: parsed.kind,
              id: typeof parsed.id === "string" ? parsed.id : undefined,
              direction: "sent",
              timestamp: Date.now(),
              socketIndex,
              dataLength: typeof parsed.data === "string" ? Buffer.byteLength(parsed.data, "utf8") : undefined,
            });
          }
        } catch {
          // ignore non-json frames
        }
      });

      ws.on("framereceived", (event) => {
        try {
          const payloadStr = typeof event.payload === "string" ? event.payload : event.payload.toString("utf8");
          const parsed = JSON.parse(payloadStr);
          if (parsed && typeof parsed.kind === "string" && parsed.kind.startsWith("terminal:")) {
            this.totalFramesRecorded++;
            const socketIndex = this.sockets.indexOf(ws);
            if (this.wsFrames.length >= TerminalSessionObserver.MAX_FRAMES) {
              this.wsFrames.shift();
            }
            this.wsFrames.push({
              kind: parsed.kind,
              id: typeof parsed.id === "string" ? parsed.id : undefined,
              direction: "received",
              timestamp: Date.now(),
              socketIndex,
              offset: typeof parsed.offset === "number" ? parsed.offset : undefined,
              incarnation: parsed.incarnation,
              dataLength: typeof parsed.data === "string" ? Buffer.byteLength(parsed.data, "utf8") : undefined,
            });
          }
        } catch {
          // ignore non-json frames
        }
      });
    });
  }

  /**
   * Retrieves diagnostic records stored in localStorage by DiagnosticsClient.
   */
  async getDiagnosticEntries(): Promise<ClientDiagnosticItem[]> {
    return this.page.evaluate(() => {
      try {
        const raw = localStorage.getItem("damhopper_diagnostics_frontend_v1");
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as ClientDiagnosticItem[]) : [];
      } catch {
        return [];
      }
    });
  }

  /**
   * Resolves active terminal window ID and session ID from the page if not supplied.
   */
  async resolveActiveTerminalSessionId(): Promise<{ windowId: string; sessionId: string }> {
    const frame = this.page.locator("[data-os-window-frame]").first();
    await frame.waitFor({ state: "visible", timeout: 15_000 });
    const winId = await frame.getAttribute("data-os-window-frame");
    if (!winId) {
      throw new Error("No visible window frame with data-os-window-frame attribute found");
    }

    const sessionId = await this.page.evaluate((targetWinId) => {
      const slot = document.querySelector(`[data-os-window-slot="${targetWinId}"]`);
      if (!slot) return null;
      const termEl = slot.querySelector(".xterm, [data-terminal-container], [data-terminal-session-id]");
      return (
        termEl?.getAttribute("data-terminal-session-id") ??
        termEl?.getAttribute("data-session-id") ??
        targetWinId
      );
    }, winId);

    return { windowId: winId, sessionId: sessionId ?? winId };
  }

  /**
   * Captures an observation snapshot for a specific session ID or the first active terminal.
   * Fails closed if baseline data is missing or invalid.
   */
  async snapshot(targetSessionId?: string): Promise<TerminalObservationSnapshot> {
    const entries = await this.getDiagnosticEntries();

    let safeSessionId = targetSessionId;
    if (safeSessionId) {
      const resolvedFromSlot = await this.page.evaluate((targetId) => {
        const slot = document.querySelector(`[data-os-window-slot="${targetId}"]`);
        if (!slot) return null;
        const termEl = slot.querySelector("[data-terminal-session-id]");
        return termEl?.getAttribute("data-terminal-session-id") ?? null;
      }, safeSessionId);
      if (resolvedFromSlot) {
        safeSessionId = resolvedFromSlot;
      }
    } else {
      const resolved = await this.resolveActiveTerminalSessionId();
      safeSessionId = resolved.sessionId;
    }

    if (this.totalFramesRecorded > this.wsFrames.length) {
      throw new Error(
        `Observation snapshot failed: Frame buffer truncated! Recorded ${this.totalFramesRecorded} frames exceeding buffer capacity ${this.wsFrames.length}. Lifecycle evidence compromised.`,
      );
    }
    // 1. Determine instanceToken from xterm_created diagnostics for this session
    const createdEntries = entries.filter(
      (e) =>
        e.scope === "terminal-panel" &&
        e.message === "xterm_created" &&
        (e.metadata?.sessionId === safeSessionId || e.metadata?.id === safeSessionId),
    );
    let token = "";
    if (createdEntries.length > 0) {
      token = String(createdEntries[createdEntries.length - 1].metadata?.instanceToken ?? "");
    }
    if (!token) {
      // Check DOM element scoped strictly to this session slot
      token = await this.page.evaluate((sid) => {
        const slot = document.querySelector(`[data-os-window-slot="${sid}"]`) ??
          document.querySelector(`[data-terminal-session-id="${sid}"]`);
        const termEl = slot?.querySelector(".xterm, [data-terminal-container], [data-xterm-instance-token]") ?? slot;
        return termEl?.getAttribute("data-xterm-instance-token") ?? "";
      }, safeSessionId);
    }

    // If still no token, fail closed
    if (!token) {
      throw new Error(
        `Observation snapshot failed: No xterm instance or diagnostic token found for session "${safeSessionId}"`,
      );
    }

    // 2. Match diagnostic events by session OR instanceToken
    const sessionEntries = entries.filter((e) => {
      const meta = e.metadata;
      if (!meta) return false;
      if (meta.instanceToken === token) return true;
      return meta.sessionId === safeSessionId || meta.id === safeSessionId;
    });

    const disposedEntries = sessionEntries.filter(
      (e) => e.scope === "terminal-panel" && e.message === "xterm_disposed",
    );

    // WS frame counts strictly for this exact session
    const wsSessionFrames = this.wsFrames.filter((f) => f.id === safeSessionId);
    const wsAttachCount = wsSessionFrames.filter((f) => f.direction === "sent" && f.kind === "terminal:attach").length;
    const wsReplayFrames = wsSessionFrames.filter((f) => f.direction === "received" && f.kind === "terminal:buffer");
    const wsReplayCount = wsReplayFrames.length;

    const wsOutputFrames = wsSessionFrames.filter((f) => f.direction === "received" && f.kind === "terminal:output");
    const outputCount = wsOutputFrames.length;
    let outputBytes = 0;
    let lastOutputOffset = 0;
    let latestIncarnation: number | string | null = null;

    for (const out of wsOutputFrames) {
      if (out.offset && out.offset > lastOutputOffset) {
        lastOutputOffset = out.offset;
      }
      if (out.incarnation !== undefined && out.incarnation !== null) {
        latestIncarnation = out.incarnation;
      }
      if (typeof out.dataLength === "number") {
        outputBytes += out.dataLength;
      }
    }

    // Diagnostic counts
    const diagnosticAttachCount = sessionEntries.filter(
      (e) => e.scope === "terminal-panel" && e.message === "terminal.attach",
    ).length;
    const diagnosticReplayCount = sessionEntries.filter(
      (e) => e.scope === "terminal-panel" && e.message === "buffer_replay",
    ).length;
    const resetCount = sessionEntries.filter(
      (e) => e.scope === "terminal-buffer-replay" && e.message === "buffer_reset",
    ).length;

    // Resolve backend epoch strictly scoped to this session's slot
    const backendEpoch = await this.page.evaluate((sid) => {
      const slot =
        document.querySelector(`[data-os-window-slot="${sid}"]`) ??
        document.querySelector(`[data-terminal-session-id="${sid}"]`);
      const termEl = slot?.querySelector("[data-xterm-server-epoch]") ?? slot;
      return termEl?.getAttribute("data-xterm-server-epoch") ?? null;
    }, safeSessionId);

    return {
      sessionId: safeSessionId,
      token,
      createdCount: createdEntries.length,
      disposeCount: disposedEntries.length,
      wsAttachCount,
      diagnosticAttachCount,
      attachCount: wsAttachCount + diagnosticAttachCount,
      wsReplayCount,
      diagnosticReplayCount,
      replayCount: wsReplayCount + diagnosticReplayCount,
      resetCount,
      outputCount,
      outputBytes,
      lastOutputOffset,
      backendEpoch,
      incarnation: latestIncarnation,
      timestamp: Date.now(),
    };
  }

  /**
   * Asserts ZERO lifecycle delta between two snapshots.
   * Specifically:
   * - SAME xterm token (no new Terminal instantiation or DOM recreation)
   * - ZERO delta created count
   * - ZERO delta disposed count
   * - ZERO delta attach count (neither WS frame nor diagnostic attach)
   * - ZERO delta replay count (neither WS frame nor diagnostic buffer replay)
   * - ZERO delta reset count
   * - Backend epoch unchanged
   * - Incarnation unchanged
   */
  assertZeroDelta(
    before: TerminalObservationSnapshot,
    after: TerminalObservationSnapshot,
    contextLabel = "transition",
  ): void {
    if (!before.token || !after.token) {
      throw new Error(
        `[${contextLabel}] Invalid observation: baseline token is missing (before="${before.token}", after="${after.token}")`,
      );
    }

    expect(
      after.token,
      `[${contextLabel}] Expected same xterm instance token across transition; saw mutation from "${before.token}" to "${after.token}"`,
    ).toBe(before.token);

    const deltaCreated = after.createdCount - before.createdCount;
    expect(
      deltaCreated,
      `[${contextLabel}] Expected 0 delta xterm_created; saw ${deltaCreated}`,
    ).toBe(0);

    const deltaDisposed = after.disposeCount - before.disposeCount;
    expect(
      deltaDisposed,
      `[${contextLabel}] Expected 0 delta xterm_disposed; saw ${deltaDisposed}`,
    ).toBe(0);

    const deltaAttach = after.attachCount - before.attachCount;
    expect(
      deltaAttach,
      `[${contextLabel}] Expected 0 delta attach (WS + diagnostic); saw ${deltaAttach}`,
    ).toBe(0);

    const deltaReplay = after.replayCount - before.replayCount;
    expect(
      deltaReplay,
      `[${contextLabel}] Expected 0 delta replay (WS buffer + diagnostic replay); saw ${deltaReplay}`,
    ).toBe(0);

    const deltaReset = after.resetCount - before.resetCount;
    expect(
      deltaReset,
      `[${contextLabel}] Expected 0 delta reset; saw ${deltaReset}`,
    ).toBe(0);

    expect(
      after.backendEpoch,
      `[${contextLabel}] Expected unchanged backend epoch`,
    ).toBe(before.backendEpoch);

    expect(
      after.incarnation,
      `[${contextLabel}] Expected unchanged incarnation`,
    ).toBe(before.incarnation);
  }

  /**
   * Updates application layout zoom level cleanly through document style,
   * CSS custom property, and storage event to ensure AppZoomContext and
   * reciprocal terminal zoom stay synchronized.
   */
  async setAppZoom(zoomPercent: number): Promise<void> {
    await this.page.evaluate((level) => {
      document.documentElement.style.zoom = `${level}%`;
      document.documentElement.style.setProperty("--app-zoom", String(level / 100));
      try {
        localStorage.setItem(
          "dam-hopper:app-zoom:v1",
          JSON.stringify({ version: 1, zoom: level }),
        );
      } catch {
        // ignore
      }
      window.dispatchEvent(new Event("dam-hopper:app-zoom-change"));
    }, zoomPercent);
  }

  /**
   * Resets viewport and zoom to FHD standard (1440x900, 100% zoom).
   */
  async resetViewportAndZoom(): Promise<void> {
    await this.page.setViewportSize({ width: 1440, height: 900 });
    await this.setAppZoom(100);
  }
}

/**
 * Creates and initializes a TerminalSessionObserver for the given Playwright page.
 */
export function createTerminalSessionObserver(page: Page): TerminalSessionObserver {
  return new TerminalSessionObserver(page);
}

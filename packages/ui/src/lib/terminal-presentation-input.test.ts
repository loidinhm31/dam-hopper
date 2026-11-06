// @vitest-environment jsdom
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  acquireTerminalPresentation,
  computePresentedInputSuppression,
  isCurrentTerminalPresenter,
  releaseTerminalPresentation,
  runIfCurrentPresenter,
  setPresenterInputSuppression,
  subscribeTerminalPresentation,
} from "./terminal-presentation-input.js";

function createMockTerminal(): Terminal {
  const textarea = document.createElement("textarea");
  textarea.tabIndex = 0;
  return {
    options: {
      disableStdin: false,
    },
    textarea,
  } as unknown as Terminal;
}

describe("terminal-presentation-input", () => {
  it("unmanaged terminal preserves legacy behavior (equals panelSuppressed)", () => {
    const term = createMockTerminal();

    // Not yet acquired -> unmanaged
    expect(computePresentedInputSuppression(term, false)).toBe(false);
    expect(computePresentedInputSuppression(term, true)).toBe(true);

    // Subscribing alone does not mark it managed
    const listener = vi.fn();
    const unsub = subscribeTerminalPresentation(term, listener);
    expect(computePresentedInputSuppression(term, false)).toBe(false);
    expect(computePresentedInputSuppression(term, true)).toBe(true);
    unsub();
  });

  it("Hub -> Standalone handoff where old presenter cleanup runs AFTER successor acquired", () => {
    const term = createMockTerminal();

    // Hub acquires
    const hubToken = acquireTerminalPresentation(term, "hub-pane-1");
    expect(isCurrentTerminalPresenter(term, hubToken)).toBe(true);
    expect(computePresentedInputSuppression(term, false)).toBe(false);

    // Standalone window acquires successor token
    const standaloneToken = acquireTerminalPresentation(
      term,
      "standalone-term-1",
    );
    expect(isCurrentTerminalPresenter(term, standaloneToken)).toBe(true);
    expect(isCurrentTerminalPresenter(term, hubToken)).toBe(false);

    // Old presenter late cleanup runs AFTER successor acquired
    const oldCleanup = vi.fn();
    const ran = runIfCurrentPresenter(term, hubToken, oldCleanup);
    expect(ran).toBe(false);
    expect(oldCleanup).not.toHaveBeenCalled();

    // Successor remains interactive and current
    expect(computePresentedInputSuppression(term, false)).toBe(false);
  });

  it("Hub -> Standalone handoff where old presenter cleanup runs BEFORE successor acquired", () => {
    const term = createMockTerminal();

    // Hub acquires
    const hubToken = acquireTerminalPresentation(term, "hub-pane-1");
    expect(computePresentedInputSuppression(term, false)).toBe(false);

    // Hub unmounts / releases before standalone acquires
    const oldCleanup = vi.fn();
    const ran = runIfCurrentPresenter(term, hubToken, oldCleanup);
    expect(ran).toBe(true);
    expect(oldCleanup).toHaveBeenCalledTimes(1);

    releaseTerminalPresentation(term, hubToken);
    // Managed terminal with no presenter stays suppressed
    expect(computePresentedInputSuppression(term, false)).toBe(true);

    // Standalone acquires -> notifies subscribers -> unsuppressed
    const listener = vi.fn();
    subscribeTerminalPresentation(term, listener);

    const standaloneToken = acquireTerminalPresentation(
      term,
      "standalone-term-1",
    );
    expect(listener).toHaveBeenCalled();
    expect(isCurrentTerminalPresenter(term, standaloneToken)).toBe(true);
    expect(computePresentedInputSuppression(term, false)).toBe(false);
  });

  it("quiet-PTY recovery: acquisition notifies subscribers synchronously", () => {
    const term = createMockTerminal();
    let effectiveSuppressed = true;

    // TerminalPanel subscribes to presentation changes
    subscribeTerminalPresentation(term, () => {
      effectiveSuppressed = computePresentedInputSuppression(term, false);
    });

    // Acquire restores input immediately without PTY drain activity
    acquireTerminalPresentation(term, "presenter-1");
    expect(effectiveSuppressed).toBe(false);
  });

  it("managed terminal with no presenter stays suppressed after replay completion", () => {
    const term = createMockTerminal();

    // Acquired then released
    const token = acquireTerminalPresentation(term, "temp-presenter");
    releaseTerminalPresentation(term, token);

    // While replay was active: panelSuppressed was true
    expect(computePresentedInputSuppression(term, true)).toBe(true);

    // Replay finishes: panelSuppressed flips to false, but terminal has no presenter
    expect(computePresentedInputSuppression(term, false)).toBe(true);
  });

  it("manages presenter-specific suppression reasons", () => {
    const term = createMockTerminal();
    const token = acquireTerminalPresentation(term, "presenter-1");

    const listener = vi.fn();
    subscribeTerminalPresentation(term, listener);

    // Add suppression reason
    setPresenterInputSuppression(term, token, "inactive-tab", true);
    expect(computePresentedInputSuppression(term, false)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Idempotent call doesn't notify
    setPresenterInputSuppression(term, token, "inactive-tab", true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Clear suppression reason
    setPresenterInputSuppression(term, token, "inactive-tab", false);
    expect(computePresentedInputSuppression(term, false)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stale release and stale reason toggles are no-ops", () => {
    const term = createMockTerminal();
    const token1 = acquireTerminalPresentation(term, "p1");
    const token2 = acquireTerminalPresentation(term, "p2");

    const listener = vi.fn();
    subscribeTerminalPresentation(term, listener);

    // Stale release does not release token2
    releaseTerminalPresentation(term, token1);
    expect(isCurrentTerminalPresenter(term, token2)).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    // Stale reason change does not mutate state or notify
    setPresenterInputSuppression(term, token1, "inactive", true);
    expect(computePresentedInputSuppression(term, false)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("token epochs never reset when a presenter releases and reacquires", () => {
    const term = createMockTerminal();

    const tokenV1 = acquireTerminalPresentation(term, "presenter-1");
    expect(tokenV1.epoch).toBe(1);

    releaseTerminalPresentation(term, tokenV1);

    const tokenV2 = acquireTerminalPresentation(term, "presenter-1");
    expect(tokenV2.epoch).toBe(2);
    expect(tokenV2.epoch).toBeGreaterThan(tokenV1.epoch);

    // Old tokenV1 is definitely not current and cannot release or cleanup
    expect(isCurrentTerminalPresenter(term, tokenV1)).toBe(false);
    expect(runIfCurrentPresenter(term, tokenV1, () => {})).toBe(false);
  });

  it("acquisition clears previous suppression reasons", () => {
    const term = createMockTerminal();
    const token1 = acquireTerminalPresentation(term, "p1");

    setPresenterInputSuppression(term, token1, "inactive", true);
    expect(computePresentedInputSuppression(term, false)).toBe(true);

    // Successor acquires -> previous suppression reasons cleared
    acquireTerminalPresentation(term, "p2");
    expect(computePresentedInputSuppression(term, false)).toBe(false);
  });

  it("panel-level suppression wins unconditionally even when active presenter has no suppression reasons", () => {
    const term = createMockTerminal();
    acquireTerminalPresentation(term, "active-presenter");

    // No presenter suppression reasons
    expect(computePresentedInputSuppression(term, false)).toBe(false);

    // Panel suppression (e.g. cognito, modal capture, retired owner) wins unconditionally
    expect(computePresentedInputSuppression(term, true)).toBe(true);
  });
});

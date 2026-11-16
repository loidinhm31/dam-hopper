// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamQualityEvent } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { BrowserOwnerScope, BrowserTabRuntime } from "./browser-tab-types.js";
import { BrowserTools, type BrowserToolsProps } from "./browser-tools.js";

const owner: ConnectionRef = { profileId: "profile-1", generation: 1 };
const scope: BrowserOwnerScope = {
  profileId: "profile-1",
  endpoint: "https://hub.example.com",
  principal: "alice",
  namespace: "prod",
};

const baseTab: BrowserTabRuntime = {
  tabId: "tab-1",
  kind: "ordinary",
  phase: "live",
  sessionId: "sess-12345678",
  committedUrl: "https://example.com",
  isController: false, // view-only user!
  actionSequence: 1,
};

const baseEvent: StreamQualityEvent = {
  kind: "streamQuality",
  subscriptionEpoch: "sub-1",
  preference: "high",
  producerRun: "run-1",
  captureVersion: "100",
  sharedTier: "high",
  viewerTier: "high",
  fps: 30,
  jpegQuality: 85,
  scale: 1,
  imageWidth: 1920,
  imageHeight: 1080,
  audioSuppressed: false,
  audioReason: null,
  status: "effective",
};

describe("BrowserTools quality controls & diagnostics", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
      container = null;
    }
  });

  function renderTools(overrides: Partial<BrowserToolsProps> = {}) {
    const props: BrowserToolsProps = {
      panelId: "panel-tools",
      windowId: "win-1",
      owner,
      verifiedScope: scope,
      activeTab: baseTab,
      privacyMasked: false,
      ownerMismatch: false,
      navigationError: null,
      selectionPending: false,
      selectionActive: false,
      controlPending: false,
      clearPending: false,
      clearStatus: null,
      onAcquireControl: vi.fn(),
      onReleaseControl: vi.fn(),
      onToggleSelection: vi.fn(),
      onClearRemembered: vi.fn(),
      onCloseTools: vi.fn(),
      onAttachSession: vi.fn(),
      onWindowStateUpdated: vi.fn(),
      qualityPreference: "auto",
      qualityStatus: baseEvent,
      qualityPending: false,
      onQualityPreferenceChange: vi.fn(),
      ...overrides,
    };

    act(() => {
      root?.render(<BrowserTools {...props} />);
    });

    return props;
  }

  it("renders controlled quality selector matching qualityPreference for non-Auto initial props, tab change, panel reopen, and generation reset", () => {
    // 1. Non-Auto initial props: "high" rendered
    renderTools({ qualityPreference: "high" });
    let select = container?.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select).toBeTruthy();
    expect(select?.value).toBe("high");

    // 2. Tab change: props update to "medium", rendered value updates to "medium"
    renderTools({ qualityPreference: "medium" });
    select = container?.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select?.value).toBe("medium");

    // 3. Panel reopen: unmount panel and remount with retained "high", rendered value is "high"
    act(() => {
      root?.unmount();
      root = createRoot(container!);
    });
    renderTools({ qualityPreference: "high" });
    select = container?.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select?.value).toBe("high");

    // 4. Generation reset: props update to "auto", rendered value updates to "auto"
    renderTools({ qualityPreference: "auto" });
    select = container?.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select?.value).toBe("auto");
  });

  it("disables quality selector and shows unavailable when masked or owner mismatch or tab not live", () => {
    // 1. Privacy masked
    renderTools({ privacyMasked: true });
    let select = container?.querySelector<HTMLSelectElement>('[data-testid="browser-quality-selector"]');
    expect(select?.disabled).toBe(true);
    expect(container?.querySelector('[data-testid="browser-quality-unavailable"]')).toBeTruthy();

    // 2. Owner mismatch
    renderTools({ privacyMasked: false, ownerMismatch: true });
    select = container?.querySelector<HTMLSelectElement>('[data-testid="browser-quality-selector"]');
    expect(select?.disabled).toBe(true);

    // 3. Tab not live
    renderTools({
      privacyMasked: false,
      ownerMismatch: false,
      activeTab: { ...baseTab, phase: "connecting" },
    });
    select = container?.querySelector<HTMLSelectElement>('[data-testid="browser-quality-selector"]');
    expect(select?.disabled).toBe(true);
  });

  it("shows pending state when qualityPending is true", () => {
    renderTools({ qualityPending: true });
    expect(container?.querySelector('[data-testid="browser-quality-pending"]')).toBeTruthy();
  });

  it("renders effective shared tier, resolution, FPS, and status when not masked", () => {
    renderTools({
      qualityStatus: {
        ...baseEvent,
        sharedTier: "medium",
        fps: 24,
        status: "switching",
        imageWidth: 1280,
        imageHeight: 720,
      },
    });

    const tier = container?.querySelector('[data-testid="browser-quality-shared-tier"]');
    expect(tier?.textContent).toBe("medium");

    const scaleJpeg = container?.querySelector('[data-testid="browser-quality-scale-jpeg"]');
    expect(scaleJpeg?.textContent).toContain("1280×720");

    const fps = container?.querySelector('[data-testid="browser-quality-fps"]');
    expect(fps?.textContent).toContain("24");

    const status = container?.querySelector('[data-testid="browser-quality-status"]');
    expect(status?.textContent).toContain("switching");
  });

  it("shows shared limitation note when requested preference differs from shared tier", () => {
    renderTools({
      qualityPreference: "high",
      qualityStatus: {
        ...baseEvent,
        sharedTier: "low",
        viewerTier: "high",
      },
    });

    const note = container?.querySelector('[data-testid="browser-quality-shared-limit-note"]');
    expect(note).toBeTruthy();
    expect(note?.textContent).toContain("Fidelity is shared and limited by the slowest visible viewer");
  });

  it("does not show shared limitation note when requested matches shared tier and viewer tier matches", () => {
    renderTools({
      qualityPreference: "high",
      qualityStatus: {
        ...baseEvent,
        sharedTier: "high",
        viewerTier: "high",
      },
    });

    const note = container?.querySelector('[data-testid="browser-quality-shared-limit-note"]');
    expect(note).toBeNull();
  });

  it("shows audio suppression reason Muted vs Bandwidth constrained", () => {
    // 1. Muted
    renderTools({
      qualityStatus: {
        ...baseEvent,
        audioSuppressed: true,
        audioReason: "muted",
      },
    });
    let reason = container?.querySelector('[data-testid="browser-quality-audio-reason"]');
    expect(reason?.textContent).toBe("Muted");

    // 2. Bandwidth constrained
    renderTools({
      qualityStatus: {
        ...baseEvent,
        audioSuppressed: true,
        audioReason: "bandwidth",
      },
    });
    reason = container?.querySelector('[data-testid="browser-quality-audio-reason"]');
    expect(reason?.textContent).toBe("Bandwidth constrained");

    // 3. Hidden
    renderTools({
      qualityStatus: {
        ...baseEvent,
        audioSuppressed: true,
        audioReason: "hidden",
      },
    });
    reason = container?.querySelector('[data-testid="browser-quality-audio-reason"]');
    expect(reason?.textContent).toBe("Hidden");

    // 4. Stalled
    renderTools({
      qualityStatus: {
        ...baseEvent,
        audioSuppressed: true,
        audioReason: "stalled",
      },
    });
    reason = container?.querySelector('[data-testid="browser-quality-audio-reason"]');
    expect(reason?.textContent).toBe("Stalled");
  });

  it("hides all diagnostics under privacy masking", () => {
    renderTools({
      privacyMasked: true,
      qualityStatus: baseEvent,
    });

    const diag = container?.querySelector('[data-testid="browser-quality-diagnostics"]');
    expect(diag).toBeNull();
  });

  it("shows numeric diagnostics only for effective/switching, and Warming… or Unavailable otherwise", () => {
    // 1. Warming: no numeric resolution or fps
    renderTools({
      qualityStatus: {
        ...baseEvent,
        status: "warming",
      },
    });
    expect(container?.querySelector('[data-testid="browser-quality-status"]')?.textContent).toBe("Warming…");
    expect(container?.querySelector('[data-testid="browser-quality-scale-jpeg"]')).toBeNull();
    expect(container?.querySelector('[data-testid="browser-quality-fps"]')).toBeNull();

    // 2. Unavailable: no numeric resolution or fps
    renderTools({
      qualityStatus: {
        ...baseEvent,
        status: "unavailable",
      },
    });
    expect(container?.querySelector('[data-testid="browser-quality-status"]')?.textContent).toBe("Unavailable");
    expect(container?.querySelector('[data-testid="browser-quality-scale-jpeg"]')).toBeNull();
    expect(container?.querySelector('[data-testid="browser-quality-fps"]')).toBeNull();

    // 3. Switching: shows numeric settings
    renderTools({
      qualityStatus: {
        ...baseEvent,
        status: "switching",
      },
    });
    expect(container?.querySelector('[data-testid="browser-quality-status"]')?.textContent).toBe("switching");
    expect(container?.querySelector('[data-testid="browser-quality-scale-jpeg"]')).toBeTruthy();
    expect(container?.querySelector('[data-testid="browser-quality-fps"]')).toBeTruthy();
  });

  it("handles keyboard Escape key to close browser tools", () => {
    const onCloseTools = vi.fn();
    renderTools({ onCloseTools });

    const panel = container?.querySelector<HTMLDivElement>('[data-testid="browser-tools-panel"]');
    expect(panel).toBeTruthy();

    act(() => {
      panel!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    expect(onCloseTools).toHaveBeenCalledTimes(1);
  });

  it("keeps Cancel Select clickable while selectionActive even if control is lost, and wires Copy Selection button and status", () => {
    const onToggleSelection = vi.fn();
    const onCopySelection = vi.fn();

    renderTools({
      activeTab: { ...baseTab, isController: false, leaseToken: undefined },
      selectionActive: true,
      onToggleSelection,
      onCopySelection,
    });

    const selectBtn = container?.querySelector<HTMLButtonElement>('[data-testid="browser-select-element-btn"]');
    expect(selectBtn?.textContent).toBe("Cancel Select");
    expect(selectBtn?.disabled).toBe(false);
    act(() => { selectBtn!.click(); });
    expect(onToggleSelection).toHaveBeenCalledTimes(1);

    const copyBtn = container?.querySelector<HTMLButtonElement>('[data-testid="browser-copy-selection-btn"]');
    expect(copyBtn?.disabled).toBe(true);

    renderTools({
      activeTab: { ...baseTab, isController: true, leaseToken: "lease-1" },
      selectionActive: false,
      copyStatus: { kind: "success", message: "Copied 5 chars to clipboard" },
      onCopySelection,
    });
    const copyBtnLive = container?.querySelector<HTMLButtonElement>('[data-testid="browser-copy-selection-btn"]');
    expect(copyBtnLive?.disabled).toBe(false);
    act(() => { copyBtnLive!.click(); });
    expect(onCopySelection).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="browser-copy-selection-status"]')?.textContent).toBe(
      "Copied 5 chars to clipboard",
    );
  });

  it("renders Open/Close DevTools button gated on live unmasked tab and fires onToggleDevTools", () => {
    const onToggleDevTools = vi.fn();
    renderTools({ devToolsOpen: false, onToggleDevTools });

    const btn = container?.querySelector<HTMLButtonElement>('[data-testid="browser-tools-devtools-btn"]');
    expect(btn?.textContent).toBe("Open DevTools");
    expect(btn?.disabled).toBe(false);
    act(() => { btn!.click(); });
    expect(onToggleDevTools).toHaveBeenCalledTimes(1);

    renderTools({ devToolsOpen: true, onToggleDevTools });
    expect(container?.querySelector<HTMLButtonElement>('[data-testid="browser-tools-devtools-btn"]')?.textContent).toBe(
      "Close DevTools",
    );

    renderTools({ privacyMasked: true, onToggleDevTools });
    expect(container?.querySelector<HTMLButtonElement>('[data-testid="browser-tools-devtools-btn"]')?.disabled).toBe(true);

    renderTools({ activeTab: { ...baseTab, phase: "new-tab", sessionId: undefined }, onToggleDevTools });
    expect(container?.querySelector<HTMLButtonElement>('[data-testid="browser-tools-devtools-btn"]')?.disabled).toBe(true);
  });
});

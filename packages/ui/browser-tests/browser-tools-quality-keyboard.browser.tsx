import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { QualityPreference, StreamQualityEvent } from "@/api/browser-host-types.js";
import { BrowserTools, type BrowserToolsProps } from "@/os/browser/browser-tools.js";
import type { BrowserTabRuntime } from "@/os/browser/browser-tab-types.js";
import "@/index.css";

const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const baseTab: BrowserTabRuntime = {
  tabId: "tab-1",
  kind: "page",
  title: "Example Tab",
  committedUrl: "https://example.test",
  phase: "live",
  pendingSessionId: null,
  sessionId: "session-1",
  isController: false,
  snapshot: {
    tabId: "tab-1",
    browserSessionId: "session-1",
    browserIncarnation: "inc-1",
    profileEpoch: "1",
    status: "attached",
    viewport: { width: 800, height: 600, scale: 1 },
    navigationRevision: "1",
  },
};

const baseEvent: StreamQualityEvent = {
  kind: "streamQuality",
  subscriptionEpoch: "sub-1",
  producerRun: "run-1",
  captureVersion: "10",
  sharedTier: "high",
  viewerTier: "high",
  fps: 30,
  jpegQuality: 85,
  scale: 1,
  imageWidth: 800,
  imageHeight: 600,
  audioSuppressed: false,
  audioReason: null,
  status: "effective",
};

describe("BrowserTools quality selector keyboard & real user interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function getBaseProps(): BrowserToolsProps {
    return {
      panelId: "tools-panel-test",
      windowId: "win-1",
      owner: { profileId: "profile-1", generation: 1 },
      verifiedScope: {
        principal: "dev-user",
        namespace: "dev",
        profileId: "profile-1",
      },
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
    };
  }

  function StatefulTools(props: {
    initialPref?: QualityPreference;
    onQualityPreferenceChange?: (pref: QualityPreference) => void;
    onCloseTools?: () => void;
  }) {
    const [pref, setPref] = useState<QualityPreference>(props.initialPref ?? "auto");
    const base = getBaseProps();
    return (
      <BrowserTools
        {...base}
        qualityPreference={pref}
        onQualityPreferenceChange={(next) => {
          setPref(next);
          props.onQualityPreferenceChange?.(next);
        }}
        onCloseTools={props.onCloseTools ?? base.onCloseTools}
      />
    );
  }

  it("selects options via real userEvent.selectOptions without manual DOM assignment", async () => {
    const onQualityPreferenceChange = vi.fn();
    await act(async () => {
      root.render(<StatefulTools onQualityPreferenceChange={onQualityPreferenceChange} />);
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select).toBeTruthy();
    expect(select?.value).toBe("auto");

    await userEvent.selectOptions(select!, "high");

    expect(select?.value).toBe("high");
    expect(onQualityPreferenceChange).toHaveBeenCalledWith("high");
  });

  it("drives quality selector via real keyboard interaction in Chromium (focus + ArrowDown)", async () => {
    const onQualityPreferenceChange = vi.fn();
    await act(async () => {
      root.render(<StatefulTools onQualityPreferenceChange={onQualityPreferenceChange} />);
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select).toBeTruthy();
    expect(select?.value).toBe("auto");

    select!.focus();
    expect(document.activeElement).toBe(select);

    // ArrowDown in Chromium moves from Auto (1st option) to High (2nd option)
    await userEvent.keyboard("{ArrowDown}");

    expect(select?.value).toBe("high");
    expect(onQualityPreferenceChange).toHaveBeenCalledWith("high");
  });

  it("handles keyboard Escape key inside tools panel to close browser tools", async () => {
    const onCloseTools = vi.fn();
    await act(async () => {
      root.render(<StatefulTools onCloseTools={onCloseTools} />);
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select).toBeTruthy();

    select!.focus();
    expect(document.activeElement).toBe(select);

    await userEvent.keyboard("{Escape}");

    expect(onCloseTools).toHaveBeenCalledTimes(1);
  });

  it("asserts controlled rendered value for non-Auto initial props, tab change, panel reopen, and generation reset", async () => {
    const base = getBaseProps();

    // 1. Non-Auto initial props: "high" rendered
    await act(async () => {
      root.render(<BrowserTools {...base} qualityPreference="high" />);
    });
    let select = container.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select).toBeTruthy();
    expect(select?.value).toBe("high");

    // 2. Tab change: props update to "medium", rendered value updates to "medium"
    await act(async () => {
      root.render(<BrowserTools {...base} qualityPreference="medium" />);
    });
    select = container.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select?.value).toBe("medium");

    // 3. Panel reopen: unmount panel and remount with retained "high", rendered value is "high"
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<BrowserTools {...base} qualityPreference="high" />);
    });
    select = container.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select?.value).toBe("high");

    // 4. Generation reset: props update to "auto", rendered value updates to "auto"
    await act(async () => {
      root.render(<BrowserTools {...base} qualityPreference="auto" />);
    });
    select = container.querySelector<HTMLSelectElement>(
      '[data-testid="browser-quality-selector"]',
    );
    expect(select?.value).toBe("auto");
  });
});

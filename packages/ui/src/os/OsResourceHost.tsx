import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TerminalKeepAliveHost } from "@/components/organisms/TerminalKeepAliveHost.js";
import { MonacoKeepAliveHost } from "./MonacoKeepAliveHost.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { useWindowStore } from "./window-store.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { getConnectionSnapshot } from "@/api/connections.js";

export interface OsResourceHostProps {
  mountedSessions?: MountedSession[];
  children: ReactNode;
}

interface BrowserSlotRegistration {
  windowId: string;
  url: string;
  element: HTMLElement | null;
  isVisible: boolean;
}

const browserSlots = new Map<string, BrowserSlotRegistration>();
const browserSlotListeners = new Set<() => void>();

export function registerBrowserSlot(
  windowId: string,
  url: string,
  element: HTMLElement | null,
  isVisible: boolean,
): () => void {
  browserSlots.set(windowId, { windowId, url, element, isVisible });
  browserSlotListeners.forEach((l) => l());
  return () => {
    browserSlots.delete(windowId);
    browserSlotListeners.forEach((l) => l());
  };
}

export function updateBrowserSlot(
  windowId: string,
  element: HTMLElement | null,
  isVisible: boolean,
): void {
  const existing = browserSlots.get(windowId);
  if (existing) {
    existing.element = element;
    existing.isVisible = isVisible;
    browserSlotListeners.forEach((l) => l());
  }
}

function OsBrowserIframe({
  windowId,
  url,
}: {
  windowId: string;
  url: string;
}) {
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const [slot, setSlot] = useState<BrowserSlotRegistration | null>(() =>
    browserSlots.get(windowId) ?? null,
  );
  const [geometry, setGeometry] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    visible: boolean;
  }>({
    top: -10000,
    left: -10000,
    width: 800,
    height: 600,
    visible: false,
  });

  useEffect(() => {
    const update = () => {
      setSlot(browserSlots.get(windowId) ?? null);
    };
    browserSlotListeners.add(update);
    return () => {
      browserSlotListeners.delete(update);
    };
  }, [windowId]);

  useEffect(() => {
    if (!slot || !slot.isVisible || !slot.element) {
      setGeometry((prev) =>
        prev.visible
          ? { ...prev, visible: false, top: -10000, left: -10000 }
          : prev,
      );
      return;
    }

    const el = slot.element;
    const updateGeometry = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setGeometry({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          visible: true,
        });
      }
    };

    updateGeometry();
    const observer = new ResizeObserver(updateGeometry);
    observer.observe(el);
    window.addEventListener("resize", updateGeometry);
    window.addEventListener("scroll", updateGeometry, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("scroll", updateGeometry, true);
    };
  }, [slot]);

  const isEffectiveVisible = geometry.visible && !isCognitoActive;

  return (
    <div
      aria-hidden={!isEffectiveVisible}
      data-os-browser-host-window={windowId}
      style={{
        position: "fixed",
        top: geometry.top,
        left: geometry.left,
        width: geometry.width,
        height: geometry.height,
        visibility: isEffectiveVisible ? "visible" : "hidden",
        pointerEvents: isEffectiveVisible ? "auto" : "none",
        zIndex: 20,
        overflow: "hidden",
      }}
    >
      <iframe
        src={url}
        data-os-preview-iframe="true"
        data-testid={`preview-iframe-${windowId}`}
        title={`Browser preview ${url}`}
        className="w-full h-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}

function OsBrowserKeepAliveHost() {
  const sessionWindows = useWindowStore((state) => state.session.windows);
  const browserWindows = useMemo(
    () =>
      Object.values(sessionWindows).filter((w) => w.appId === "browser"),
    [sessionWindows],
  );

  return (
    <div
      aria-hidden="true"
      data-os-browser-parking-host="true"
      style={{ pointerEvents: "none" }}
    >
      {browserWindows.map((win) => {
        const previewUrl =
          (win.appState?.url as string | undefined) ?? "http://localhost:5173";
        return (
          <OsBrowserIframe key={win.id} windowId={win.id} url={previewUrl} />
        );
      })}
    </div>
  );
}

export function OsResourceHost({
  mountedSessions = [],
  children,
}: OsResourceHostProps) {
  const sessionWindows = useWindowStore((state) => state.session.windows);

  const derivedTerminalSessions: MountedSession[] = useMemo(() => {
    const sessions: MountedSession[] = [];
    for (const w of Object.values(sessionWindows)) {
      if (w.appId !== "terminals") continue;
      const profileId = w.ctx.profileId;
      // Fail closed: if profile is unknown, do not mount ambient fallback
      const snap = getConnectionSnapshot(profileId);
      if (!snap && profileId !== "default") continue;

      const sessionId =
        (w.appState?.sessionId as string | undefined) ??
        (w.appState?.terminalId as string | undefined) ??
        `${profileId}:default`;
      sessions.push({
        sessionId,
        project: w.ctx.projectId ?? "default",
        command: "",
        profileId,
        terminalRef: {
          profileId,
          id: sessionId,
        },
      });
    }
    return sessions;
  }, [sessionWindows]);

  const allMountedSessions = useMemo(() => {
    const seen = new Set<string>();
    const merged: MountedSession[] = [];
    for (const s of [...mountedSessions, ...derivedTerminalSessions]) {
      const pId = s.terminalRef?.profileId ?? s.profileId ?? "default";
      const sId = s.terminalRef?.id ?? s.sessionId;
      const key = `${pId}::${sId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    }
    return merged;
  }, [mountedSessions, derivedTerminalSessions]);
  return (
    <MonacoKeepAliveHost>
      <TerminalKeepAliveHost mountedSessions={allMountedSessions} />
      <OsBrowserKeepAliveHost />
      {children}
    </MonacoKeepAliveHost>
  );
}

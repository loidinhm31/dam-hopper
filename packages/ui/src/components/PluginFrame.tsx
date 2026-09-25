import { useLayoutEffect, useRef } from "react";
import type { FrameSession, FrameSessionState } from "@/plugins/bridge-host.js";

interface PluginFrameProps {
  session: FrameSession;
  srcdoc: string;
  title: string;
  state: FrameSessionState;
}

const STATUS_LABEL: Record<FrameSessionState, string> = {
  Fetching: "Fetching protected interface",
  LoadingInitialDocument: "Loading isolated document",
  Bootstrapping: "Verifying frame",
  AwaitingPortAck: "Awaiting secure channel",
  Ready: "Connected",
  Revoked: "Session closed",
};

export function PluginFrame({
  session,
  srcdoc,
  title,
  state,
}: PluginFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("title", title);
    iframe.className = "plugin-frame";
    iframe.onload = () => session.handleDocumentLoad();
    iframe.srcdoc = srcdoc;
    const handleMessage = (event: MessageEvent) => {
      session.handleWindowMessage(event);
    };
    window.addEventListener("message", handleMessage);
    container.append(iframe);
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      session.revoke("Plugin frame window is unavailable");
    } else {
      session.bindFrame(frameWindow);
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      iframe.onload = null;
      session.revoke("Plugin frame unmounted");
      iframe.remove();
    };
  }, [session, srcdoc, title]);

  return (
    <section
      className="plugin-frame-shell"
      aria-label={`${title} isolated plugin interface`}
      aria-busy={state !== "Ready" && state !== "Revoked"}
    >
      <div className="plugin-frame-status" role="status" aria-live="polite">
        <span
          className={
            state === "Ready"
              ? "plugin-frame-status-dot plugin-frame-status-dot-ready"
              : "plugin-frame-status-dot"
          }
          aria-hidden="true"
        />
        <span>{STATUS_LABEL[state]}</span>
      </div>
      <div ref={containerRef} className="plugin-frame-viewport" />
    </section>
  );
}

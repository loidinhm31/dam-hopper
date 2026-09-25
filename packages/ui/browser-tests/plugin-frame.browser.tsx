import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PluginFrame } from "../src/components/PluginFrame.js";
import {
  FrameSession,
  type ExactRequestFrameSessionBackend,
  type FrameSessionState,
} from "../src/plugins/bridge-host.js";
import { buildVerifiedPluginDocument } from "../src/plugins/plugin-document.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function waitForState(
  subscribe: (resolve: (state: FrameSessionState) => void) => void,
  expected: FrameSessionState,
): Promise<FrameSessionState> {
  const { promise, resolve, reject } =
    Promise.withResolvers<FrameSessionState>();
  const timer = window.setTimeout(
    () => reject(new Error(`Timed out waiting for ${expected}`)),
    5_000,
  );
  subscribe((state) => {
    if (state !== expected) return;
    window.clearTimeout(timer);
    resolve(state);
  });
  return promise;
}

describe("PluginFrame opaque host", () => {
  it("completes frame.ready → bootstrap → portAck before opening context", async () => {
    const calls: string[] = [];
    let stateListener: ((state: FrameSessionState) => void) | null = null;
    const backend: ExactRequestFrameSessionBackend = {
      requestCorrelation: "exact",
      getEpoch: async () => {
        calls.push("epoch");
        return 41;
      },
      openContext: async () => {
        calls.push("open");
        return {
          contextId: "context-1",
          bindingRevision: 1,
          grantRevision: 1,
          activationGeneration: 7,
          expiresAt: Date.now() + 60_000,
        };
      },
      closeContext: async () => {
        calls.push("close");
      },
      invoke: async () => ({ result: null }),
      cancel: async () => ({ outcome: "accepted" }),
      onContextRevoked: () => () => undefined,
      onOwnerInvalidated: () => () => undefined,
    };
    const session = new FrameSession({
      installationId: "evcrate-installation",
      activationGeneration: 7,
      target: { project: "fixture" },
      allowedOperations: ["history.summary"],
      allowCurrentAccountPolicy: false,
      backend,
      onStateChange: (state) => stateListener?.(state),
    });
    const ready = waitForState((listener) => {
      stateListener = listener;
    }, "Ready");
    const pluginScript = `
      const frameSession = window.__FRAME_SESSION__;
      const activationGeneration = window.__ACTIVATION_GENERATION__;
      window.addEventListener("message", (event) => {
        if (event.data?.type !== "host.bootstrap" || event.ports.length !== 1) return;
        const port = event.ports[0];
        port.start();
        port.postMessage({
          type: "frame.portAck",
          bridgeVersion: "1.0.0",
          frameSession,
          activationGeneration,
          nonce: event.data.nonce,
        });
      }, { once: true });
      window.parent.postMessage({
        type: "frame.ready",
        bridgeVersion: "1.0.0",
        frameSession,
        activationGeneration,
      }, "*");
    `;
    const source = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fixture</title><style>body{margin:0}</style></head><body><main>Fixture</main><script>${pluginScript}</script></body></html>`;
    const bytes = new TextEncoder().encode(source);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const verified = await buildVerifiedPluginDocument({
      bytes,
      expectedDigest: digest,
      frameSession: session.frameSession,
      activationGeneration: 7,
    });

    const rootNode = document.createElement("div");
    document.body.append(rootNode);
    const root = createRoot(rootNode);
    root.render(
      <PluginFrame
        session={session}
        srcdoc={verified.srcdoc}
        title="Fixture plugin"
        state="LoadingInitialDocument"
      />,
    );

    await ready;
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.hasAttribute("src")).toBe(false);
    expect(iframe?.contentDocument).toBeNull();
    expect(calls).toEqual(["epoch", "open"]);

    root.unmount();
    const settled = Promise.withResolvers<void>();
    window.setTimeout(settled.resolve, 0);
    await settled.promise;
    expect(calls).toContain("close");
  });
});

import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PluginFrame } from "../src/components/PluginFrame.js";
import {
  FrameSession,
  type ExactRequestFrameSessionBackend,
  type FrameSessionState,
} from "../src/plugins/bridge-host.js";
import {
  ADVISOR_WORKSPACE_EXTENSION_V1,
  type AdvisorWorkspaceContext,
} from "../src/plugins/bridge-validators.js";
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
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data?.type !== "host.bootstrap") return;
        channel.port1.postMessage({
          type: "frame.portAck",
          bridgeVersion: "1.0.0",
          frameSession,
          activationGeneration,
          nonce: event.data.nonce,
        });
      };
      channel.port1.start();
      window.parent.postMessage({
        type: "frame.ready",
        bridgeVersion: "1.0.0",
        frameSession,
        activationGeneration,
      }, "*", [channel.port2]);
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
  it("delivers workspace-advisor-v1 contextReady and updates selected-ID via host.workspaceChanged without new context", async () => {
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
          contextId: "context-advisor-1",
          bindingRevision: 1,
          grantRevision: 1,
          activationGeneration: 7,
          scopeKind: "history-root",
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

    const initialContext: AdvisorWorkspaceContext = {
      revision: 1,
      authorityKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      project: {
        projectId: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        label: "Primary Project",
      },
      historyScope: "history-root",
      contextScope: "history-root",
      allowedOperations: ["history.summary"],
    };

    const uiIntents: string[] = [];
    const session = new FrameSession({
      installationId: "evcrate.advisor",
      activationGeneration: 7,
      target: { project: "fixture" },
      allowedOperations: ["history.summary"],
      allowCurrentAccountPolicy: false,
      extension: ADVISOR_WORKSPACE_EXTENSION_V1,
      workspaceContext: initialContext,
      expectedContextScope: "history-root",
      backend,
      onUiIntent: (intent) => uiIntents.push(intent),
      onStateChange: (state) => stateListener?.(state),
    });

    const ready = waitForState((listener) => {
      stateListener = listener;
    }, "Ready");

    const pluginScript = `
      const frameSession = window.__FRAME_SESSION__;
      const activationGeneration = window.__ACTIVATION_GENERATION__;
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const msg = event.data;
        if (msg?.type === "host.bootstrap") {
          channel.port1.postMessage({
            type: "frame.portAck",
            bridgeVersion: "1.0.0",
            frameSession,
            activationGeneration,
            nonce: msg.nonce,
          });
        } else if (msg?.type === "host.contextReady") {
          channel.port1.postMessage({
            type: "frame.uiIntent",
            bridgeVersion: "1.0.0",
            frameSession,
            activationGeneration,
            intent: "activate",
          });
        } else if (msg?.type === "host.workspaceChanged") {
          channel.port1.postMessage({
            type: "frame.uiIntent",
            bridgeVersion: "1.0.0",
            frameSession,
            activationGeneration,
            intent: "dismiss",
          });
        }
      };
      channel.port1.start();
      window.parent.postMessage({
        type: "frame.ready",
        bridgeVersion: "1.0.0",
        frameSession,
        activationGeneration,
      }, "*", [channel.port2]);
    `;

    const source = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Advisor Frame</title><style>body{margin:0}</style></head><body><script>${pluginScript}</script></body></html>`;
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
        title="Advisor Frame"
        state={session.state}
      />,
    );

    await ready;
    expect(calls).toEqual(["epoch", "open"]);

    const delay = (ms: number): Promise<void> => {
      const { promise, resolve } = Promise.withResolvers<void>();
      window.setTimeout(resolve, ms);
      return promise;
    };
    const waitForIntent = async (expected: string) => {
      for (let i = 0; i < 50; i++) {
        if (uiIntents.includes(expected)) return;
        await delay(20);
      }
      throw new Error("Timed out waiting for intent: " + expected);
    };

    await waitForIntent("activate");
    expect(uiIntents).toContain("activate");
    // Update workspace selection to second project under same authority
    const updatedContext: AdvisorWorkspaceContext = {
      ...initialContext,
      revision: 2,
      project: {
        projectId: "1111111111111111111111111111111111111111111111111111111111111111",
        label: "Secondary Project",
      },
    };
    const didUpdate = session.updateWorkspaceContext(updatedContext);
    expect(didUpdate).toBe(true);

    await waitForIntent("dismiss");
    expect(uiIntents).toContain("dismiss");

    // Still only 1 openContext call!
    expect(calls).toEqual(["epoch", "open"]);

    root.unmount();
  });
});

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getTransport,
  reconfigureTransport,
  resetTransportListeners,
  initTransportListeners,
  WsTransport,
} = vi.hoisted(() => ({
  getTransport: vi.fn(),
  reconfigureTransport: vi.fn(),
  resetTransportListeners: vi.fn(),
  initTransportListeners: vi.fn(),
  WsTransport: vi.fn(),
}));

vi.mock("./transport.js", () => ({ getTransport, reconfigureTransport }));
vi.mock("./ws-transport.js", () => ({ WsTransport }));
vi.mock("@/hooks/use-sse.js", () => ({
  initTransportListeners,
  resetTransportListeners,
}));

import { reinitializeTransport } from "./transport-utils.js";

describe("reinitializeTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete document.documentElement.dataset.appHost;
  });

  it("re-registers push listeners after installing the replacement transport", () => {
    const destroy = vi.fn();
    const nextTransport = { onEvent: vi.fn() };
    getTransport.mockReturnValue({ destroy });
    WsTransport.mockImplementation(
      class {
        constructor() {
          return nextTransport;
        }
      },
    );

    reinitializeTransport("http://monitor.example");

    expect(destroy).toHaveBeenCalledOnce();
    expect(resetTransportListeners).toHaveBeenCalledOnce();
    expect(WsTransport).toHaveBeenCalledWith(
      "http://monitor.example",
      undefined,
    );
    expect(reconfigureTransport).toHaveBeenCalledWith(nextTransport);
    expect(initTransportListeners).toHaveBeenCalledOnce();
    expect(initTransportListeners.mock.invocationCallOrder[0]).toBeGreaterThan(
      reconfigureTransport.mock.invocationCallOrder[0],
    );
  });

  it("keeps unsupported native separate-origin profiles idle", () => {
    document.documentElement.dataset.appHost = "native";
    document.documentElement.dataset.appPlatform = "android";
    getTransport.mockReturnValue({ destroy: vi.fn() });

    reinitializeTransport("http://remote.example", "profile-a");

    expect(WsTransport).not.toHaveBeenCalled();
    expect(reconfigureTransport).toHaveBeenCalledOnce();
  });

  it("connects Windows native desktop profiles through the browser transport", () => {
    document.documentElement.dataset.appHost = "native";
    document.documentElement.dataset.appPlatform = "windows";
    const nextTransport = { onEvent: vi.fn() };
    getTransport.mockReturnValue({ destroy: vi.fn() });
    WsTransport.mockImplementation(
      class {
        constructor() {
          return nextTransport;
        }
      },
    );

    reinitializeTransport("http://remote.example", "profile-a");

    expect(WsTransport).toHaveBeenCalledWith(
      "http://remote.example",
      "profile-a",
    );
    expect(reconfigureTransport).toHaveBeenCalledWith(nextTransport);
  });

  it("forwards the active profile ID to the replacement transport", () => {
    const nextTransport = { onEvent: vi.fn() };
    getTransport.mockReturnValue({ destroy: vi.fn() });
    WsTransport.mockImplementation(
      class {
        constructor() {
          return nextTransport;
        }
      },
    );

    reinitializeTransport("http://monitor.example", "profile-a");

    expect(WsTransport).toHaveBeenCalledWith(
      "http://monitor.example",
      "profile-a",
    );
  });
});

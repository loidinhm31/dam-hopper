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
    expect(WsTransport).toHaveBeenCalledWith("http://monitor.example");
    expect(reconfigureTransport).toHaveBeenCalledWith(nextTransport);
    expect(initTransportListeners).toHaveBeenCalledOnce();
    expect(initTransportListeners.mock.invocationCallOrder[0]).toBeGreaterThan(
      reconfigureTransport.mock.invocationCallOrder[0],
    );
  });
});

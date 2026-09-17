import type { Transport, TransportInvokeOptions } from "./transport.js";
import type { WsStatus } from "./ws-transport.js";

function noopUnsubscribe(): () => void {
  return () => {};
}

/** Transport used while the setup screen has no active server profile. */
export class IdleTransport implements Transport {
  invoke<T>(
    _channel?: string,
    _data?: unknown,
    _options?: TransportInvokeOptions | number,
  ): Promise<T> {
    return Promise.reject(new Error("Server profile required"));
  }

  destroy(): void {}
  getStatus(): WsStatus {
    return "disconnected";
  }

  onTerminalData(): () => void {
    return noopUnsubscribe();
  }

  onTerminalExit(): () => void {
    return noopUnsubscribe();
  }

  onEvent(): () => void {
    return noopUnsubscribe();
  }

  terminalWrite(): void {}

  terminalResize(): void {}

  terminalAttach(): boolean {
    return false;
  }

  onTerminalBuffer(): () => void {
    return noopUnsubscribe();
  }

  onStatusChange(cb: (status: WsStatus) => void): () => void {
    cb("disconnected");
    return noopUnsubscribe();
  }
}

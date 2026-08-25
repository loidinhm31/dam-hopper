import type { Transport } from "./transport.js";
import type { WsStatus } from "./ws-transport.js";

function noopUnsubscribe(): () => void {
  return () => {};
}

/** Transport used while the setup screen has no active server profile. */
export class IdleTransport implements Transport {
  invoke<T>(): Promise<T> {
    return Promise.reject(new Error("Server profile required"));
  }

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

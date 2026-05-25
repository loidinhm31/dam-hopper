import type { Transport } from "@dam-hopper/ui/api/transport";

function noopUnsubscribe(): () => void {
  return () => {};
}

export class IdleTransport implements Transport {
  invoke<T>(): Promise<T> {
    return Promise.reject(new Error("Server profile required"));
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

  terminalAttach(): void {}

  onTerminalBuffer(): () => void {
    return noopUnsubscribe();
  }

  onStatusChange(cb: (status: string) => void): () => void {
    cb("idle");
    return noopUnsubscribe();
  }
}

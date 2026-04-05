import { getMainWindow } from "../window.js";
import type { EventSink } from "./event-sink.js";

/** Routes PTY events to the Electron renderer via webContents.send(). */
export class ElectronEventSink implements EventSink {
  sendTerminalData(sessionId: string, data: string): void {
    getMainWindow()?.webContents.send(`terminal:data:${sessionId}`, data);
  }

  sendTerminalExit(sessionId: string, exitCode: number | null): void {
    getMainWindow()?.webContents.send(`terminal:exit:${sessionId}`, {
      exitCode,
    });
  }

  sendTerminalChanged(): void {
    getMainWindow()?.webContents.send("terminal:changed", {});
  }
}

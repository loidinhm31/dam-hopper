import { BrowserWindow } from "electron";
import { EV } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

function send(channel: string, data: unknown): void {
  try {
    BrowserWindow.getAllWindows()[0]?.webContents.send(channel, data);
  } catch {
    // Window may be destroyed mid-send; ignore
  }
}

export function wireEventEmitters(holder: CtxHolder): void {
  const wire = () => {
    const ctx = holder.current;

    ctx.bulkGitService.emitter.on("progress", (event) => {
      send(EV.GIT_PROGRESS, event);
    });
  };

  wire();
  holder.onSwitch = wire;
}

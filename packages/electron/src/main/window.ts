import { BrowserWindow } from "electron";

export function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

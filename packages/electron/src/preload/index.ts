import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("devhub", {
  // Phase 02 will add all API methods
  // Phase 03 will add terminal methods
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
});

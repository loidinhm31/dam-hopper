import type { AppManifest, OsAppId } from "./types.js";

export const APP_MANIFESTS: Record<OsAppId, AppManifest> = {
  terminals: {
    appId: "terminals",
    displayName: "Terminals",
    instancing: "multi-instance",
    minimumCtx: "profile",
    defaultPlacement: "tile",
    minSize: { width: 320, height: 240 },
    intents: ["terminal:open", "terminal:focus"],
  },
  editor: {
    appId: "editor",
    displayName: "Editor",
    instancing: "multi-instance",
    minimumCtx: "project",
    defaultPlacement: "tile",
    minSize: { width: 360, height: 280 },
    intents: ["file:edit", "file:open"],
  },
  browser: {
    appId: "browser",
    displayName: "Browser Preview",
    instancing: "multi-instance",
    minimumCtx: "profile",
    defaultPlacement: "float",
    minSize: { width: 400, height: 300 },
    intents: ["browser:preview", "browser:open"],
  },
};

export function getAppManifest(appId: OsAppId): AppManifest | undefined {
  return APP_MANIFESTS[appId];
}

export function listAppManifests(): AppManifest[] {
  return Object.values(APP_MANIFESTS);
}

export function isAppId(id: string): id is OsAppId {
  return Object.prototype.hasOwnProperty.call(APP_MANIFESTS, id);
}

import type {
  FloatBounds,
  OsDesktop,
  OsSessionV1,
  OsWindow,
  RestorePlacement,
  WindowContext,
} from "./types.js";
import { isAppId } from "./app-registry.js";
import { createDefaultOsSession } from "./window-ops.js";
import { collectTilePanes, isValidTileNode } from "@/lib/tile-tree.js";
import type { TileNode } from "@/types/tile-tree.js";

export const OS_SESSION_STORAGE_KEY = "dam-hopper:os:v1:session";

export interface PersistenceNotice {
  kind: "invalid-schema" | "storage-error" | "corrupt-data";
  message: string;
}

let autosaveSuspended = false;
let preservedCorruptBytes: string | null = null;

export function isAutosaveSuspended(): boolean {
  return autosaveSuspended;
}

export function getPreservedCorruptBytes(): string | null {
  return preservedCorruptBytes;
}

export function resumeAutosave(): void {
  autosaveSuspended = false;
  preservedCorruptBytes = null;
}

function sanitizeAppState(
  appId: string,
  rawState?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!rawState || typeof rawState !== "object") return undefined;
  if (appId === "terminals") {
    const projected: Record<string, unknown> = {};
    if (typeof rawState.sessionId === "string")
      projected.sessionId = rawState.sessionId;
    if (typeof rawState.cwd === "string") projected.cwd = rawState.cwd;
    return Object.keys(projected).length > 0 ? projected : undefined;
  }
  if (appId === "editor") {
    const projected: Record<string, unknown> = {};
    if (typeof rawState.filePath === "string")
      projected.filePath = rawState.filePath;
    return Object.keys(projected).length > 0 ? projected : undefined;
  }
  if (appId === "browser") {
    const projected: Record<string, unknown> = {};
    if (typeof rawState.url === "string") projected.url = rawState.url;
    return Object.keys(projected).length > 0 ? projected : undefined;
  }
  return undefined;
}

export function sanitizeSessionForPersistence(
  session: OsSessionV1,
): OsSessionV1 {
  const sanitizedWindows: Record<string, OsWindow> = {};
  for (const [id, win] of Object.entries(session.windows)) {
    const ctx: WindowContext = {
      profileId: String(win.ctx?.profileId ?? "default"),
    };
    if (typeof win.ctx?.projectId === "string") {
      ctx.projectId = win.ctx.projectId;
    }
    if (typeof win.ctx?.worktreeId === "string") {
      ctx.worktreeId = win.ctx.worktreeId;
    }

    let floatBounds: FloatBounds | undefined;
    if (win.floatBounds && typeof win.floatBounds === "object") {
      floatBounds = {
        x: Number(win.floatBounds.x) || 0,
        y: Number(win.floatBounds.y) || 0,
        width: Number(win.floatBounds.width) || 720,
        height: Number(win.floatBounds.height) || 520,
      };
    }

    let restorePlacement: RestorePlacement | undefined;
    if (win.restorePlacement && typeof win.restorePlacement === "object") {
      restorePlacement = {
        mode: win.restorePlacement.mode === "float" ? "float" : "tile",
        desktopId: String(win.restorePlacement.desktopId),
        floatBounds: win.restorePlacement.floatBounds
          ? {
              x: Number(win.restorePlacement.floatBounds.x) || 0,
              y: Number(win.restorePlacement.floatBounds.y) || 0,
              width: Number(win.restorePlacement.floatBounds.width) || 720,
              height: Number(win.restorePlacement.floatBounds.height) || 520,
            }
          : undefined,
      };
    }

    sanitizedWindows[id] = {
      id: win.id,
      appId: win.appId,
      title: String(win.title || "Window"),
      ctx,
      mode: win.mode === "float" ? "float" : "tile",
      desktopId: String(win.desktopId),
      maximized: Boolean(win.maximized),
      minimized: Boolean(win.minimized),
      floatBounds,
      restorePlacement,
      appState: sanitizeAppState(win.appId, win.appState),
    };
  }

  const sanitizedDesktops: OsDesktop[] = session.desktops.map((d) => ({
    id: String(d.id),
    name: String(d.name || "Desktop"),
    defaultCtx: d.defaultCtx
      ? {
          profileId: String(d.defaultCtx.profileId),
          projectId: d.defaultCtx.projectId
            ? String(d.defaultCtx.projectId)
            : undefined,
        }
      : undefined,
    tree: d.tree,
    floatingWindowIds: Array.isArray(d.floatingWindowIds)
      ? d.floatingWindowIds.map(String)
      : [],
    focusedWindowId: d.focusedWindowId ? String(d.focusedWindowId) : null,
  }));

  return {
    schema: 1,
    activeDesktopId: String(session.activeDesktopId),
    desktops: sanitizedDesktops,
    windows: sanitizedWindows,
  };
}

export function validateOsSession(candidate: unknown): {
  valid: boolean;
  error?: string;
  session?: OsSessionV1;
} {
  if (typeof candidate !== "object" || candidate === null) {
    return { valid: false, error: "Session must be a non-null object" };
  }
  const obj = candidate as Record<string, unknown>;
  if (obj.schema !== 1) {
    return {
      valid: false,
      error: `Unsupported schema version: ${String(obj.schema)}`,
    };
  }
  if (typeof obj.activeDesktopId !== "string") {
    return { valid: false, error: "Missing or invalid activeDesktopId" };
  }
  if (!Array.isArray(obj.desktops) || obj.desktops.length === 0) {
    return { valid: false, error: "Desktops must be a non-empty array" };
  }
  if (typeof obj.windows !== "object" || obj.windows === null) {
    return { valid: false, error: "Windows must be an object map" };
  }

  const desktopIds = new Set<string>();
  for (const d of obj.desktops) {
    if (typeof d !== "object" || d === null) {
      return { valid: false, error: "Desktop must be an object" };
    }
    const desk = d as Record<string, unknown>;
    if (typeof desk.id !== "string" || typeof desk.name !== "string") {
      return { valid: false, error: "Desktop missing id or name" };
    }
    if (desktopIds.has(desk.id)) {
      return { valid: false, error: `Duplicate desktop id: ${desk.id}` };
    }
    desktopIds.add(desk.id);
  }

  if (!desktopIds.has(obj.activeDesktopId)) {
    return {
      valid: false,
      error: `activeDesktopId '${obj.activeDesktopId}' not found in desktops`,
    };
  }

  function isValidFloatBounds(bounds: unknown): boolean {
    if (typeof bounds !== "object" || bounds === null) return false;
    const b = bounds as Record<string, unknown>;
    return (
      typeof b.x === "number" &&
      Number.isFinite(b.x) &&
      typeof b.y === "number" &&
      Number.isFinite(b.y) &&
      typeof b.width === "number" &&
      Number.isFinite(b.width) &&
      b.width > 0 &&
      typeof b.height === "number" &&
      Number.isFinite(b.height) &&
      b.height > 0
    );
  }

  const windowsMap = obj.windows as Record<string, unknown>;
  for (const [winId, winObj] of Object.entries(windowsMap)) {
    if (typeof winObj !== "object" || winObj === null) {
      return { valid: false, error: `Invalid window object at ${winId}` };
    }
    const w = winObj as Record<string, unknown>;
    if (w.id !== winId) {
      return {
        valid: false,
        error: `Window id mismatch: key=${winId}, id=${String(w.id)}`,
      };
    }
    if (typeof w.appId !== "string" || !isAppId(w.appId)) {
      return { valid: false, error: `Unknown appId: ${String(w.appId)}` };
    }
    if (typeof w.title !== "string") {
      return { valid: false, error: `Window ${winId} missing valid title` };
    }
    if (
      typeof w.ctx !== "object" ||
      w.ctx === null ||
      typeof (w.ctx as Record<string, unknown>).profileId !== "string" ||
      !(w.ctx as Record<string, unknown>).profileId
    ) {
      return {
        valid: false,
        error: `Window ${winId} missing valid ctx.profileId`,
      };
    }
    const ctx = w.ctx as Record<string, unknown>;
    if (ctx.projectId !== undefined && typeof ctx.projectId !== "string") {
      return { valid: false, error: `Window ${winId} has invalid ctx.projectId` };
    }
    if (ctx.worktreeId !== undefined && typeof ctx.worktreeId !== "string") {
      return { valid: false, error: `Window ${winId} has invalid ctx.worktreeId` };
    }
    if (w.mode !== "tile" && w.mode !== "float") {
      return { valid: false, error: `Invalid window mode: ${String(w.mode)}` };
    }
    if (typeof w.desktopId !== "string" || !desktopIds.has(w.desktopId)) {
      return {
        valid: false,
        error: `Window ${winId} references unknown desktopId: ${String(w.desktopId)}`,
      };
    }
    if (
      typeof w.maximized !== "boolean" ||
      typeof w.minimized !== "boolean"
    ) {
      return {
        valid: false,
        error: `Window ${winId} missing boolean maximized or minimized`,
      };
    }
    if (w.floatBounds !== undefined && !isValidFloatBounds(w.floatBounds)) {
      return { valid: false, error: `Window ${winId} has invalid floatBounds` };
    }
    if (w.restorePlacement !== undefined) {
      if (typeof w.restorePlacement !== "object" || w.restorePlacement === null) {
        return { valid: false, error: `Window ${winId} has invalid restorePlacement` };
      }
      const rp = w.restorePlacement as Record<string, unknown>;
      if (rp.mode !== "tile" && rp.mode !== "float") {
        return { valid: false, error: `Window ${winId} has invalid restorePlacement.mode` };
      }
      if (typeof rp.desktopId !== "string" || !desktopIds.has(rp.desktopId)) {
        return { valid: false, error: `Window ${winId} has invalid restorePlacement.desktopId` };
      }
      if (rp.floatBounds !== undefined && !isValidFloatBounds(rp.floatBounds)) {
        return { valid: false, error: `Window ${winId} has invalid restorePlacement.floatBounds` };
      }
    }
  }

  // Track placements of every window
  const placedInTree = new Map<string, string[]>();
  const placedInFloat = new Map<string, string[]>();

  // Validate desktops tree references
  for (const d of obj.desktops) {
    const desk = d as Record<string, unknown>;
    if (!Array.isArray(desk.floatingWindowIds)) {
      return {
        valid: false,
        error: `Invalid floatingWindowIds on desktop ${String(desk.id)}`,
      };
    }
    const seenFloatsOnDesktop = new Set<string>();
    for (const fwId of desk.floatingWindowIds) {
      if (typeof fwId !== "string" || !windowsMap[fwId]) {
        return {
          valid: false,
          error: `Floating window ${String(fwId)} not found in session windows`,
        };
      }
      if (seenFloatsOnDesktop.has(fwId)) {
        return {
          valid: false,
          error: `Duplicate floating window ${fwId} on desktop ${String(desk.id)}`,
        };
      }
      seenFloatsOnDesktop.add(fwId);

      const win = windowsMap[fwId] as Record<string, unknown>;
      if (win.desktopId !== desk.id) {
        return {
          valid: false,
          error: `Floating window ${fwId} belongs to desktop ${String(win.desktopId)}, not ${String(desk.id)}`,
        };
      }
      if (win.mode !== "float") {
        return {
          valid: false,
          error: `Window ${fwId} placed in floating list but mode is ${String(win.mode)}`,
        };
      }
      if (win.minimized) {
        return {
          valid: false,
          error: `Minimized window ${fwId} cannot appear in floating list`,
        };
      }

      const list = placedInFloat.get(fwId) ?? [];
      list.push(String(desk.id));
      placedInFloat.set(fwId, list);
    }

    if (desk.tree !== null) {
      const isWindowItemValid = (item: unknown): item is string =>
        typeof item === "string" && Boolean(windowsMap[item]);
      if (!isValidTileNode(desk.tree, isWindowItemValid)) {
        return {
          valid: false,
          error: `Invalid tile tree or unreferenced window in desktop ${String(desk.id)}`,
        };
      }

      const panes = collectTilePanes(desk.tree as TileNode<string>);
      for (const pane of panes) {
        if (pane.items.length === 0) {
          return {
            valid: false,
            error: `Empty pane ${pane.id} in desktop ${String(desk.id)}`,
          };
        }
        if (!pane.active || !pane.items.includes(pane.active)) {
          return {
            valid: false,
            error: `Pane ${pane.id} has active item '${String(pane.active)}' not present in items`,
          };
        }
        for (const itemId of pane.items) {
          const itemIdStr = String(itemId);
          const win = windowsMap[itemIdStr] as Record<string, unknown>;
          if (win.desktopId !== desk.id) {
            return {
              valid: false,
              error: `Window ${itemIdStr} in tile tree belongs to desktop ${String(win.desktopId)}, not ${String(desk.id)}`,
            };
          }
          if (win.mode !== "tile") {
            return {
              valid: false,
              error: `Window ${itemIdStr} in tile tree has mode ${String(win.mode)}`,
            };
          }
          if (win.minimized) {
            return {
              valid: false,
              error: `Minimized window ${itemIdStr} cannot appear in tile tree`,
            };
          }

          const list = placedInTree.get(itemIdStr) ?? [];
          list.push(String(desk.id));
          placedInTree.set(itemIdStr, list);
        }
      }
    }

    // Validate desktop focus
    if (desk.focusedWindowId !== null && desk.focusedWindowId !== undefined) {
      if (typeof desk.focusedWindowId !== "string" || !windowsMap[desk.focusedWindowId]) {
        return {
          valid: false,
          error: `Desktop ${String(desk.id)} has unknown focusedWindowId ${String(desk.focusedWindowId)}`,
        };
      }
      const focusedWin = windowsMap[desk.focusedWindowId] as Record<string, unknown>;
      if (focusedWin.desktopId !== desk.id) {
        return {
          valid: false,
          error: `Desktop ${String(desk.id)} focused window belongs to ${String(focusedWin.desktopId)}`,
        };
      }
      if (focusedWin.minimized) {
        return {
          valid: false,
          error: `Desktop ${String(desk.id)} focused window cannot be minimized`,
        };
      }
      const isPlacedOnDesk =
        (placedInFloat.get(desk.focusedWindowId)?.includes(String(desk.id)) ?? false) ||
        (placedInTree.get(desk.focusedWindowId)?.includes(String(desk.id)) ?? false);
      if (!isPlacedOnDesk) {
        return {
          valid: false,
          error: `Desktop ${String(desk.id)} focused window is not placed on that desktop`,
        };
      }
    }
  }

  // Enforce exactly-one-placement across all windows
  for (const [winId, winObj] of Object.entries(windowsMap)) {
    const w = winObj as Record<string, unknown>;
    const treePlacements = placedInTree.get(winId) ?? [];
    const floatPlacements = placedInFloat.get(winId) ?? [];
    const totalPlacements = treePlacements.length + floatPlacements.length;

    if (w.minimized) {
      if (totalPlacements > 0) {
        return {
          valid: false,
          error: `Minimized window ${winId} must have zero placements, found ${totalPlacements}`,
        };
      }
    } else {
      if (w.mode === "tile") {
        if (floatPlacements.length > 0) {
          return {
            valid: false,
            error: `Tiled window ${winId} cannot appear in floating list`,
          };
        }
        if (treePlacements.length !== 1) {
          return {
            valid: false,
            error: `Tiled window ${winId} must appear exactly once in tree, found ${treePlacements.length}`,
          };
        }
      } else if (w.mode === "float") {
        if (treePlacements.length > 0) {
          return {
            valid: false,
            error: `Floating window ${winId} cannot appear in tile tree`,
          };
        }
        if (floatPlacements.length !== 1) {
          return {
            valid: false,
            error: `Floating window ${winId} must appear exactly once in float list, found ${floatPlacements.length}`,
          };
        }
      }
    }
  }

  return { valid: true, session: candidate as OsSessionV1 };
}

export function loadOsSession(
  storageKey: string = OS_SESSION_STORAGE_KEY,
  onNotice?: (notice: PersistenceNotice) => void,
): OsSessionV1 {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch (err) {
    onNotice?.({
      kind: "storage-error",
      message: `Failed to access localStorage: ${String(err)}`,
    });
    return createDefaultOsSession();
  }

  if (!raw) {
    return createDefaultOsSession();
  }

  try {
    const parsed = JSON.parse(raw);
    const validation = validateOsSession(parsed);
    if (!validation.valid || !validation.session) {
      autosaveSuspended = true;
      preservedCorruptBytes = raw;
      onNotice?.({
        kind: "invalid-schema",
        message: validation.error ?? "Invalid session structure",
      });
      return createDefaultOsSession();
    }
    return validation.session;
  } catch (err) {
    autosaveSuspended = true;
    preservedCorruptBytes = raw;
    onNotice?.({
      kind: "corrupt-data",
      message: `Failed to parse session JSON: ${String(err)}`,
    });
    return createDefaultOsSession();
  }
}

export function saveOsSession(
  session: OsSessionV1,
  storageKey: string = OS_SESSION_STORAGE_KEY,
  onNotice?: (notice: PersistenceNotice) => void,
): boolean {
  if (autosaveSuspended) {
    return false;
  }

  try {
    const sanitized = sanitizeSessionForPersistence(session);
    const raw = JSON.stringify(sanitized);
    localStorage.setItem(storageKey, raw);
    return true;
  } catch (err) {
    onNotice?.({
      kind: "storage-error",
      message: `Failed to save OS session to localStorage: ${String(err)}`,
    });
    return false;
  }
}

export function exportOsSessionJson(session: OsSessionV1): string {
  const sanitized = sanitizeSessionForPersistence(session);
  return JSON.stringify(sanitized, null, 2);
}

export function importOsSessionJson(raw: string): {
  success: boolean;
  session?: OsSessionV1;
  error?: string;
} {
  try {
    const parsed = JSON.parse(raw);
    const validation = validateOsSession(parsed);
    if (!validation.valid || !validation.session) {
      return { success: false, error: validation.error };
    }
    return { success: true, session: validation.session };
  } catch (err) {
    return { success: false, error: `Invalid JSON syntax: ${String(err)}` };
  }
}

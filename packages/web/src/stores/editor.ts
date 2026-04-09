/**
 * Editor store — manages open tabs, content, view state, and save protocol.
 *
 * Tabs are keyed by `${project}::${path}`.
 * - content: decoded UTF-8 string (what Monaco sees)
 * - binaryBase64: raw base64 bytes for binary hex-preview (binary tier only)
 */
import { create } from "zustand";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import { fileTier } from "@/lib/file-tier.js";
import type { FileTier } from "@/lib/file-tier.js";
import type { FsArborNode } from "@/api/fs-types.js";

export interface Tab {
  key: string;       // `${project}::${path}`
  project: string;
  path: string;
  name: string;
  mtime: number;     // Unix seconds; used for conflict detection
  size: number;
  tier: FileTier;
  mime?: string;
  /** Decoded UTF-8 content — used by Monaco (normal/degraded tiers). */
  content: string;
  /** Snapshot of content at last save/load — dirty = content !== savedContent. */
  savedContent: string;
  /** Raw base64 content for BinaryPreview (binary tier only). */
  binaryBase64?: string;
  dirty: boolean;
  viewState?: unknown;   // monaco ICodeEditorViewState
  loading: boolean;
  saving: boolean;
  conflicted: boolean;
  error?: string;
}

interface EditorState {
  tabs: Tab[];
  activeKey: string | null;

  open: (project: string, node: FsArborNode) => Promise<void>;
  close: (key: string) => void;
  setActive: (key: string) => void;
  setContent: (key: string, content: string) => void;
  save: (key: string) => Promise<void>;
  forceOverwrite: (key: string) => Promise<void>;
  reloadTab: (key: string) => Promise<void>;
  clearConflict: (key: string) => void;
  saveViewState: (key: string, vs: unknown) => void;
  getActiveTab: () => Tab | null;
}

function tabKey(project: string, path: string) {
  return `${project}::${path}`;
}

function transport(): WsTransport {
  return getTransport() as WsTransport;
}

/** Decode base64 → UTF-8 string using TextDecoder (handles multi-byte chars). */
function b64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeKey: null,

  // ---------------------------------------------------------------------------
  // open
  // ---------------------------------------------------------------------------
  open: async (project: string, node: FsArborNode) => {
    if (node.kind !== "file") return;

    const key = tabKey(project, node.id);
    const existing = get().tabs.find((t) => t.key === key);
    if (existing) {
      set({ activeKey: key });
      return;
    }

    // Optimistic tier guess from FsArborNode (no isBinary from tree)
    const optimisticTier = fileTier(node.size, false);

    const placeholder: Tab = {
      key, project, path: node.id, name: node.name,
      mtime: node.mtime, size: node.size,
      tier: optimisticTier,
      content: "", savedContent: "",
      dirty: false, loading: true, saving: false, conflicted: false,
    };

    set((s) => ({ tabs: [...s.tabs, placeholder], activeKey: key }));

    try {
      const result = await transport().fsRead(project, node.id);

      if (!result.ok && result.code === "TOO_LARGE") {
        const tl = result as { ok: false; code: "TOO_LARGE"; binary: boolean; mime?: string; mtime: number; size: number };
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.key === key
              ? { ...t, loading: false, tier: tl.binary ? "binary" : "large", mime: tl.mime, mtime: tl.mtime, size: tl.size }
              : t,
          ),
        }));
        return;
      }

      if (!result.ok) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.key === key ? { ...t, loading: false, error: `Read error: ${result.code}` } : t,
          ),
        }));
        return;
      }

      const tier = fileTier(result.size, result.binary);
      const decoded = result.binary ? "" : b64ToUtf8(result.content);
      const binaryBase64 = result.binary ? result.content : undefined;

      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.key === key
            ? {
                ...t, loading: false, tier, mime: result.mime,
                mtime: result.mtime, size: result.size,
                content: decoded, savedContent: decoded,
                binaryBase64,
              }
            : t,
        ),
      }));
    } catch (e) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.key === key
            ? { ...t, loading: false, error: e instanceof Error ? e.message : "Unknown error" }
            : t,
        ),
      }));
    }
  },

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------
  close: (key: string) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.key === key);
      if (idx === -1) return s;
      const nextTabs = s.tabs.filter((t) => t.key !== key);
      let nextActive = s.activeKey;
      if (s.activeKey === key) {
        nextActive = s.tabs[idx - 1]?.key ?? s.tabs[idx + 1]?.key ?? null;
      }
      return { tabs: nextTabs, activeKey: nextActive };
    });
  },

  setActive: (key: string) => set({ activeKey: key }),

  setContent: (key: string, content: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.key === key ? { ...t, content, dirty: content !== t.savedContent } : t,
      ),
    }));
  },

  // ---------------------------------------------------------------------------
  // save
  // ---------------------------------------------------------------------------
  save: async (key: string) => {
    const tab = get().tabs.find((t) => t.key === key);
    if (!tab || tab.saving || !tab.dirty || tab.tier === "binary" || tab.tier === "large") return;

    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === key ? { ...t, saving: true } : t)),
    }));

    try {
      const result = await transport().fsWriteFile(tab.project, tab.path, tab.content, tab.mtime);

      if (result.ok) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.key === key
              ? { ...t, saving: false, dirty: false, savedContent: t.content, mtime: result.newMtime }
              : t,
          ),
        }));
      } else if (!result.ok && result.conflict) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.key === key ? { ...t, saving: false, conflicted: true } : t,
          ),
        }));
      } else {
        const errMsg = !result.ok && !result.conflict ? result.error : "unknown error";
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.key === key ? { ...t, saving: false, error: `Save failed: ${errMsg}` } : t,
          ),
        }));
      }
    } catch (e) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.key === key ? { ...t, saving: false, error: e instanceof Error ? e.message : "Save error" } : t,
        ),
      }));
    }
  },

  // ---------------------------------------------------------------------------
  // forceOverwrite — after conflict: user chose to overwrite the server copy
  // ---------------------------------------------------------------------------
  forceOverwrite: async (key: string) => {
    const tab = get().tabs.find((t) => t.key === key);
    if (!tab) return;

    // Fetch current server mtime (0-byte range read just to get mtime)
    const stat = await transport().fsRead(tab.project, tab.path, { offset: 0, len: 0 });
    const currentMtime = stat.ok ? stat.mtime : ('mtime' in stat ? (stat as { mtime: number }).mtime : tab.mtime);

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.key === key ? { ...t, saving: true, conflicted: false } : t,
      ),
    }));

    try {
      const result = await transport().fsWriteFile(tab.project, tab.path, tab.content, currentMtime);
      if (result.ok) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.key === key
              ? { ...t, saving: false, dirty: false, savedContent: t.content, mtime: result.newMtime }
              : t,
          ),
        }));
      } else {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.key === key ? { ...t, saving: false, error: "Force overwrite failed" } : t,
          ),
        }));
      }
    } catch {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.key === key ? { ...t, saving: false } : t)),
      }));
    }
  },

  // ---------------------------------------------------------------------------
  // reloadTab — after conflict: discard local changes, load from server
  // ---------------------------------------------------------------------------
  reloadTab: async (key: string) => {
    const tab = get().tabs.find((t) => t.key === key);
    if (!tab) return;

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.key === key ? { ...t, loading: true, conflicted: false } : t,
      ),
    }));

    try {
      const result = await transport().fsRead(tab.project, tab.path);
      if (!result.ok) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.key === key ? { ...t, loading: false } : t)),
        }));
        return;
      }
      const decoded = result.binary ? "" : b64ToUtf8(result.content);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.key === key
            ? {
                ...t, loading: false,
                content: decoded, savedContent: decoded,
                mtime: result.mtime, dirty: false,
                binaryBase64: result.binary ? result.content : undefined,
              }
            : t,
        ),
      }));
    } catch {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.key === key ? { ...t, loading: false } : t)),
      }));
    }
  },

  clearConflict: (key: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === key ? { ...t, conflicted: false } : t)),
    }));
  },

  saveViewState: (key: string, vs: unknown) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === key ? { ...t, viewState: vs } : t)),
    }));
  },

  getActiveTab: () => {
    const { tabs, activeKey } = get();
    return tabs.find((t) => t.key === activeKey) ?? null;
  },
}));

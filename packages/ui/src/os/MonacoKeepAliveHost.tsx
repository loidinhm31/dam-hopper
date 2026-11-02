import { useCallback, useEffect, useMemo, useRef } from "react";
import type * as monacoNs from "monaco-editor";
import { MonacoHost } from "@/components/organisms/MonacoHost.js";
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";
import { useEncryptedWrite } from "@/hooks/use-encrypted-write.js";
import { useWindowStore } from "./window-store.js";

export interface ParkedMonacoEntry {
  tabKey: string;
  element: HTMLElement;
  editor: monacoNs.editor.IStandaloneCodeEditor | null;
}

const parkedMonacoRegistry = new Map<string, ParkedMonacoEntry>();
const listeners = new Set<() => void>();
let globalMonacoParkingHost: HTMLElement | null = null;
export function getMonacoParkingHost(): HTMLElement | null {
  return globalMonacoParkingHost;
}

export function getParkedMonacoEntry(
  tabKey: string,
): ParkedMonacoEntry | undefined {
  return parkedMonacoRegistry.get(tabKey);
}

export function registerParkedMonaco(
  tabKey: string,
  element: HTMLElement,
  editor: monacoNs.editor.IStandaloneCodeEditor | null,
): () => void {
  parkedMonacoRegistry.set(tabKey, { tabKey, element, editor });
  listeners.forEach((l) => l());
  return () => {
    parkedMonacoRegistry.delete(tabKey);
    listeners.forEach((l) => l());
  };
}

export function subscribeToMonacoParking(
  tabKey: string,
  callback: (entry: ParkedMonacoEntry) => void,
): () => void {
  const listener = () => {
    const entry = parkedMonacoRegistry.get(tabKey);
    if (entry) {
      callback(entry);
    }
  };
  listeners.add(listener);
  const existing = parkedMonacoRegistry.get(tabKey);
  if (existing) {
    callback(existing);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function attachMonacoToSlot(slot: HTMLElement, tabKey: string): boolean {
  const entry = parkedMonacoRegistry.get(tabKey);
  if (!entry || !entry.element) return false;
  slot.scrollLeft = 0;
  slot.scrollTop = 0;
  entry.element.style.width = "100%";
  entry.element.style.height = "100%";
  entry.element.style.position = "absolute";
  entry.element.style.inset = "0";
  entry.element.style.display = "block";
  if (entry.element.parentElement !== slot) {
    slot.appendChild(entry.element);
  }
  entry.editor?.layout();
  return true;
}

export function parkMonacoElement(
  parkingHost: HTMLElement,
  tabKey: string,
): void {
  const entry = parkedMonacoRegistry.get(tabKey);
  if (!entry || !entry.element) return;
  if (entry.element.parentElement !== parkingHost) {
    parkingHost.appendChild(entry.element);
  }
}

export interface MonacoKeepAliveHostProps {
  children?: React.ReactNode;
}

function ParkedMonacoItem({
  tabKey,
  filePath,
  target,
}: {
  tabKey: string;
  filePath: string;
  target: ProjectTargetInput;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const { isEncryptEnabled, getPassphrase } = useEncryptMode();
  const encryptedWrite = useEncryptedWrite();

  // Ensure real tab buffer exists in useEditorStore
  useEffect(() => {
    const state = useEditorStore.getState();
    const existing = state.tabs.find((t) => t.key === tabKey);
    if (!existing) {
      const targetRef = normalizeProjectTarget(target);
      const profileId = targetRef.profileId;
      const snap = profileId ? getConnectionSnapshot(profileId) : null;
      const newTab: Tab = {
        key: tabKey,
        project: targetRef.project,
        target: targetRef,
        targetKey: projectTargetCacheKey(targetRef),
        targetAvailable: true,
        path: filePath,
        name: filePath.split("/").pop() ?? filePath,
        mtime: Date.now(),
        size: 0,
        tier: "normal",
        content: "",
        savedContent: "",
        dirty: false,
        loading: false,
        saving: false,
        conflicted: false,
        resourceBinding: snap ? { serverUrl: snap.serverUrl } : undefined,
      };
      useEditorStore.setState((s) => ({
        tabs: [...s.tabs, newTab],
      }));
    }
  }, [tabKey, filePath, target]);

  const tab = useEditorStore(
    useCallback((s) => s.tabs.find((t) => t.key === tabKey) ?? null, [tabKey]),
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const unregister = registerParkedMonaco(tabKey, el, editorRef.current);
    return () => {
      unregister();
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, [tabKey]);

  const handleSave = useCallback(async () => {
    const currentTab = useEditorStore
      .getState()
      .tabs.find((t) => t.key === tabKey);
    if (!currentTab) return;
    const project = currentTab.project;
    const ownerRef = currentTab.target?.profileId
      ? { profileId: currentTab.target.profileId, generation: 1 }
      : undefined;
    if (project && isEncryptEnabled(project, ownerRef)) {
      const passphrase = getPassphrase(project, ownerRef) ?? "";
      const result = await encryptedWrite.saveText(
        currentTab.target,
        currentTab.path,
        currentTab.content,
        passphrase,
      );
      if (result.ok) {
        useEditorStore
          .getState()
          .markSaved(tabKey, result.newMtime ?? currentTab.mtime);
      }
    } else {
      await useEditorStore.getState().save(tabKey);
    }
  }, [tabKey, isEncryptEnabled, getPassphrase, encryptedWrite]);

  return (
    <div
      ref={containerRef}
      data-monaco-tab={tabKey}
      data-testid={`monaco-tab-${tabKey}`}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <MonacoHost
        tabKey={tabKey}
        path={filePath}
        content={tab?.content ?? ""}
        tab={tab}
        tier="normal"
        onChange={(val) => useEditorStore.getState().setContent(tabKey, val)}
        onSave={() => void handleSave()}
        onViewStateChange={(vs) =>
          useEditorStore.getState().saveViewState(tabKey, vs)
        }
        onEditorReady={(editor) => {
          editorRef.current = editor;
          if (containerRef.current) {
            registerParkedMonaco(tabKey, containerRef.current, editor);
          }
        }}
      />
    </div>
  );
}

export function MonacoKeepAliveHost({ children }: MonacoKeepAliveHostProps) {
  const parkingRef = useRef<HTMLDivElement>(null);
  const sessionWindows = useWindowStore((state) => state.session.windows);

  const editorEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: Array<{
      tabKey: string;
      filePath: string;
      target: ProjectTargetInput;
    }> = [];
    for (const w of Object.values(sessionWindows)) {
      if (w.appId !== "editor") continue;
      const filePath =
        (w.appState?.filePath as string | undefined) ?? "untitled.ts";
      const target: ProjectTargetInput = {
        profileId: w.ctx.profileId,
        project: w.ctx.projectId ?? "global",
        worktreePath: w.ctx.worktreeId,
      };
      const tabKey = editorFileTabKey(target, filePath);
      if (!seen.has(tabKey)) {
        seen.add(tabKey);
        entries.push({ tabKey, filePath, target });
      }
    }
    return entries;
  }, [sessionWindows]);
  useEffect(() => {
    globalMonacoParkingHost = parkingRef.current;
    return () => {
      globalMonacoParkingHost = null;
    };
  }, []);

  const content = (
    <>
      <div
        ref={parkingRef}
        aria-hidden="true"
        data-monaco-parking-host="true"
        data-testid="monaco-keep-alive-host"
        style={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          width: 1024,
          height: 768,
          overflow: "hidden",
          top: -10000,
          left: -10000,
        }}
      >
        {editorEntries.map((entry) => (
          <ParkedMonacoItem
            key={entry.tabKey}
            tabKey={entry.tabKey}
            filePath={entry.filePath}
            target={entry.target}
          />
        ))}
      </div>
      {children}
    </>
  );
  return content;
}

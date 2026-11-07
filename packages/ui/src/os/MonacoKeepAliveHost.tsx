import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type * as monacoNs from "monaco-editor";
import { MonacoHost } from "@/components/organisms/MonacoHost.js";
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";
import {
  normalizeFsTarget,
  fsTargetKey,
  type FsTargetRef,
} from "@/api/ownership.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";
import { useEncryptedWrite } from "@/hooks/use-encrypted-write.js";
import { isNonMonacoFormat } from "@/lib/editor-format.js";
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
  key: string,
  fallbackKey?: string,
): ParkedMonacoEntry | undefined {
  return parkedMonacoRegistry.get(key) ?? (fallbackKey ? parkedMonacoRegistry.get(fallbackKey) : undefined);
}

export function registerParkedMonaco(
  key: string,
  element: HTMLElement,
  editor: monacoNs.editor.IStandaloneCodeEditor | null,
  aliasKey?: string,
): () => void {
  const entry = { tabKey: key, element, editor };
  parkedMonacoRegistry.set(key, entry);
  if (aliasKey && aliasKey !== key) {
    parkedMonacoRegistry.set(aliasKey, entry);
  }
  listeners.forEach((l) => l());
  return () => {
    parkedMonacoRegistry.delete(key);
    if (aliasKey && aliasKey !== key) {
      parkedMonacoRegistry.delete(aliasKey);
    }
    listeners.forEach((l) => l());
  };
}

export function subscribeToMonacoParking(
  key: string,
  callback: (entry: ParkedMonacoEntry) => void,
  fallbackKey?: string,
): () => void {
  const listener = () => {
    const entry = getParkedMonacoEntry(key, fallbackKey);
    if (entry) {
      callback(entry);
    }
  };
  listeners.add(listener);
  const existing = getParkedMonacoEntry(key, fallbackKey);
  if (existing) {
    callback(existing);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function attachMonacoToSlot(
  slot: HTMLElement,
  key: string,
  fallbackKey?: string,
): boolean {
  const entry = getParkedMonacoEntry(key, fallbackKey);
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
  key: string,
  fallbackKey?: string,
): void {
  const entry = getParkedMonacoEntry(key, fallbackKey);
  if (!entry || !entry.element) return;
  if (entry.element.parentElement !== parkingHost) {
    parkingHost.appendChild(entry.element);
  }
}
export interface MonacoKeepAliveHostProps {
  children?: React.ReactNode;
}

function ParkedMonacoItem({
  parkingKey,
  tabKey,
  filePath,
  target,
}: {
  parkingKey: string;
  tabKey: string;
  filePath: string;
  target: FsTargetRef;
}) {
  const parkingSlotRef = useRef<HTMLDivElement>(null);
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const { isEncryptEnabled, getPassphrase } = useEncryptMode();
  const encryptedWrite = useEncryptedWrite();

  // Ensure real tab buffer exists in useEditorStore
  useEffect(() => {
    const state = useEditorStore.getState();
    const existing = state.tabs.find(
      (t) => (t.documentKey && t.documentKey === parkingKey) || t.key === tabKey,
    );
    if (!existing) {
      const targetRef = normalizeFsTarget(target);
      const profileId = targetRef.profileId;
      const snap = profileId ? getConnectionSnapshot(profileId) : null;
      const newTab: Tab = {
        key: tabKey,
        project: targetRef.kind === "project" ? targetRef.project : "",
        target: targetRef,
        targetKey: fsTargetKey(targetRef),
        targetAvailable: true,
        path: filePath,
        name: filePath.split("/").pop() ?? filePath,
        mtime: 0,
        size: 0,
        tier: "normal",
        content: "",
        savedContent: "",
        dirty: false,
        loading: true,
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
    useCallback(
      (s) =>
        s.tabs.find(
          (t) => (t.documentKey && t.documentKey === parkingKey) || t.key === tabKey,
        ) ?? null,
      [parkingKey, tabKey],
    ),
  );

  useLayoutEffect(() => {
    const parkingSlot = parkingSlotRef.current;
    if (!parkingSlot) return;

    const el = document.createElement("div");
    el.setAttribute("data-monaco-tab", parkingKey);
    el.setAttribute("data-testid", `monaco-tab-${parkingKey}`);
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.overflow = "hidden";
    parkingSlot.appendChild(el);
    setHostEl(el);

    const unregister = registerParkedMonaco(parkingKey, el, editorRef.current, tabKey);
    return () => {
      unregister();
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
      el.remove();
      setHostEl(null);
    };
  }, [parkingKey, tabKey]);

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
      ref={parkingSlotRef}
      data-monaco-parking-slot={parkingKey}
      data-testid={`monaco-parking-slot-${parkingKey}`}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
      }}
    >
      {hostEl &&
        createPortal(
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
              registerParkedMonaco(tabKey, hostEl, editor);
            }}
          />,
          hostEl,
        )}
    </div>
  );
}

export function MonacoKeepAliveHost({ children }: MonacoKeepAliveHostProps) {
  const parkingRef = useRef<HTMLDivElement>(null);
  const sessionWindows = useWindowStore((state) => state.session.windows);
  const tabs = useEditorStore((state) => state.tabs);

  const editorEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: Array<{
      parkingKey: string;
      tabKey: string;
      filePath: string;
      target: FsTargetRef;
    }> = [];
    const tabs = useEditorStore.getState().tabs;
    for (const w of Object.values(sessionWindows)) {
      if (w.appId !== "editor") continue;
      if (
        (w.appState?.presentation as { kind?: string } | undefined)?.kind === "choose-target" ||
        !w.appState?.filePath ||
        w.appState?.filePath === "untitled.ts"
      ) {
        continue;
      }
      const filePath = w.appState.filePath as string;
      let target: FsTargetRef;
      if (w.ctx.target) {
        target = normalizeFsTarget(w.ctx.target, w.ctx.profileId);
      } else if (w.ctx.projectId) {
        target = normalizeFsTarget({
          profileId: w.ctx.profileId,
          project: w.ctx.projectId,
          worktreePath: w.ctx.worktreeId,
        });
      } else {
        target = { kind: "workspace", profileId: w.ctx.profileId ?? "" };
      }
      const tabKey = editorFileTabKey(target, filePath);
      const tab = tabs.find((t) => t.key === tabKey);
      if (isNonMonacoFormat(filePath, tab?.size, tab?.tier)) continue;
      const docKey =
        (typeof w.appState?.documentKey === "string" && w.appState.documentKey) ||
        tab?.documentKey ||
        tabKey;
      if (!seen.has(docKey)) {
        seen.add(docKey);
        entries.push({ parkingKey: docKey, tabKey, filePath, target });
      }
    }
    return entries;
  }, [sessionWindows, tabs]);
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
            key={entry.parkingKey}
            parkingKey={entry.parkingKey}
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

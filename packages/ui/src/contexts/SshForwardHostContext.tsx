import { createContext, useContext, useEffect, type ReactNode } from "react";
import { getActiveProfileId, readServerProfiles, subscribeToProfileChanges } from "@/api/server-config.js";
import type { SshForwardHost } from "@/lib/ssh-forward-host.js";

export interface SshForwardHostEnvironment { kind: "web" | "nativeDesktop" | "nativeMobile"; platform?: string; }
export interface SshForwardHostContextValue { host: SshForwardHost | null; environment: SshForwardHostEnvironment; }
const DEFAULT_CONTEXT: SshForwardHostContextValue = { host: null, environment: { kind: "web" } };
const SshForwardHostContext = createContext(DEFAULT_CONTEXT);

export function SshForwardHostProvider({ host, environment, children }: SshForwardHostContextValue & { children: ReactNode }) {
  return <SshForwardHostContext.Provider value={{ host, environment }}>{children}</SshForwardHostContext.Provider>;
}
export function useSshForwardHost(): SshForwardHostContextValue { return useContext(SshForwardHostContext); }

/** Connects desktop profile identity changes to the native forwarding scope. */
export function SshForwardScopeBridge({ children }: { children: ReactNode }) {
  const { host } = useSshForwardHost();
  useEffect(() => {
    if (!host) return;
    let disposed = false;
    let activeScopeId: string | null = null;
    const knownScopes = () => {
      const result = readServerProfiles();
      return result.status === "available" ? { status: "available" as const, ids: result.profiles.map((profile) => profile.id) } : result;
    };
    let activation: Promise<void> = Promise.resolve();
    const activate = (scopeId = getActiveProfileId()) => {
      const next = host.activateScope(scopeId).then((result) => {
        if (!disposed) activeScopeId = result.scopeId;
      });
      activation = next;
      return next;
    };
    void host.openClient(knownScopes()).then(() => activate()).catch(() => {});
    const unsubscribe = subscribeToProfileChanges((event) => {
      if (disposed) return;
      if (event.type === "activeChanged") void activate(event.activeProfileId).catch(() => {});
      if (event.type === "deleted") {
        void (async () => {
          await activation.catch(() => {});
          if (activeScopeId === event.deletedProfileId) await activate();
          if (!disposed && event.knownProfileIds.status === "available")
            await host.purgeScope(event.deletedProfileId, event.knownProfileIds);
        })().catch(() => {});
      }
    });
    return () => { disposed = true; unsubscribe(); };
  }, [host]);
  return <>{children}</>;
}

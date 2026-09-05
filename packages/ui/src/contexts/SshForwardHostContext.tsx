import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getExistingNativeScopeId,
  getNativeScopeIds,
  getActiveProfileId,
  completeNativeScopeDeletion,
  readServerProfiles,
  retireNativeScopeId,
  subscribeToProfileChanges,
} from "@/api/server-config.js";
import type { SshForwardHost } from "@/lib/ssh-forward-host.js";

export interface SshForwardHostEnvironment {
  kind: "web" | "nativeDesktop" | "nativeMobile";
  platform?: string;
}
export type SshForwardHostReadiness =
  | "unmanaged"
  | "initializing"
  | "ready"
  | "failed";
export interface SshForwardHostContextValue {
  host: SshForwardHost | null;
  environment: SshForwardHostEnvironment;
  readiness: SshForwardHostReadiness;
  readinessError: unknown | null;
  retryInitialization: () => Promise<void>;
}
const DEFAULT_CONTEXT: SshForwardHostContextValue = {
  host: null,
  environment: { kind: "web" },
  readiness: "unmanaged",
  readinessError: null,
  retryInitialization: async () => {},
};
const SshForwardHostContext = createContext(DEFAULT_CONTEXT);

export function SshForwardHostProvider({
  host,
  environment,
  children,
}: Pick<SshForwardHostContextValue, "host" | "environment"> & {
  children: ReactNode;
}) {
  return (
    <SshForwardHostContext.Provider
      value={{
        host,
        environment,
        readiness: "unmanaged",
        readinessError: null,
        retryInitialization: async () => {},
      }}
    >
      {children}
    </SshForwardHostContext.Provider>
  );
}
export function useSshForwardHost(): SshForwardHostContextValue {
  return useContext(SshForwardHostContext);
}

/** Connects desktop profile identity changes to the native forwarding scope. */
export function SshForwardScopeBridge({ children }: { children: ReactNode }) {
  const parentContext = useSshForwardHost();
  const { host } = parentContext;
  const [initialization, setInitialization] = useState<{
    host: SshForwardHost | null;
    readiness: Exclude<SshForwardHostReadiness, "unmanaged">;
    error: unknown | null;
  }>(() => ({
    host,
    readiness: host ? "initializing" : "ready",
    error: null,
  }));
  const retryRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const retryInitialization = useCallback(() => retryRef.current(), []);
  useEffect(() => {
    if (!host) {
      retryRef.current = async () => {};
      setInitialization({ host: null, readiness: "ready", error: null });
      return;
    }
    let disposed = false;
    let activeScopeId: string | null = null;
    let activationSequence = 0;
    const knownScopes = () => {
      const result = readServerProfiles();
      return result.status === "available"
        ? getNativeScopeIds(result.profiles.map((profile) => profile.id))
        : result;
    };
    type KnownScopes = ReturnType<typeof knownScopes>;
    let activation: Promise<void> = Promise.resolve();
    let openClient: Promise<
      Awaited<ReturnType<SshForwardHost["openClient"]>>
    > | null = null;
    const ensureOpenClient = (refresh = false, scopes?: KnownScopes) => {
      if (refresh || !openClient) {
        const nextOpenClient = host.openClient(scopes ?? knownScopes());
        let guardedOpenClient!: typeof nextOpenClient;
        guardedOpenClient = nextOpenClient.catch((error) => {
          if (openClient === guardedOpenClient) openClient = null;
          throw error;
        });
        openClient = guardedOpenClient;
      }
      return openClient;
    };
    const fail = (error: unknown) => {
      if (!disposed) setInitialization({ host, readiness: "failed", error });
    };
    const activate = (
      scopeId = getActiveProfileId(),
      refreshKnownScopes = false,
    ) => {
      const sequence = ++activationSequence;
      if (!disposed)
        setInitialization({ host, readiness: "initializing", error: null });
      const previousActivation = activation;
      const next = previousActivation
        .catch(() => {})
        .then(() => ensureOpenClient(refreshKnownScopes))
        .then(() => {
          const nativeScopeId =
            scopeId === null ? null : getExistingNativeScopeId(scopeId);
          if (scopeId !== null && nativeScopeId === null)
            throw new Error("Native scope identity unavailable");
          return host.activateScope(nativeScopeId);
        })
        .then((result) => {
          if (!disposed && sequence === activationSequence) {
            activeScopeId = result.scopeId;
            setInitialization({ host, readiness: "ready", error: null });
          }
        })
        .catch((error) => {
          if (sequence === activationSequence) fail(error);
          throw error;
        });
      activation = next;
      return next;
    };
    retryRef.current = () => activate(undefined, true);
    void activate().catch(() => {});
    const unsubscribe = subscribeToProfileChanges((event) => {
      if (disposed) return;
      if (event.type === "activeChanged")
        void activate(event.activeProfileId).catch(() => {});
      if (event.type === "profileListChanged")
        void activate(undefined, true).catch(() => {});
      if (event.type === "deleted") {
        void (async () => {
          const profilesBeforeRetirement = readServerProfiles();
          if (profilesBeforeRetirement.status !== "available") return;
          if (
            profilesBeforeRetirement.profiles.some(
              (profile) => profile.id === event.deletedProfileId,
            )
          )
            return;
          const nativeDeletedScopeId = retireNativeScopeId(
            event.deletedProfileId,
          );
          if (!nativeDeletedScopeId) return;
          await activation.catch(() => {});
          const currentProfiles = readServerProfiles();
          if (currentProfiles.status !== "available") return;
          const currentKnownScopes = getNativeScopeIds(
            currentProfiles.profiles.map((profile) => profile.id),
          );
          if (currentKnownScopes.status !== "available") return;
          await ensureOpenClient(false, currentKnownScopes);
          if (activeScopeId === nativeDeletedScopeId) await activate();
          if (!disposed) {
            const purgeResult = await host.purgeScope(
              nativeDeletedScopeId,
              currentKnownScopes,
            );
            if (purgeResult.purged)
              completeNativeScopeDeletion(
                event.deletedProfileId,
                nativeDeletedScopeId,
              );
          }
        })().catch(() => {});
      }
    });
    return () => {
      disposed = true;
      retryRef.current = async () => {};
      unsubscribe();
    };
  }, [host]);
  const readiness =
    host === null
      ? "ready"
      : initialization.host === host
        ? initialization.readiness
        : "initializing";
  const readinessError =
    host !== null && initialization.host === host ? initialization.error : null;
  return (
    <SshForwardHostContext.Provider
      value={{
        ...parentContext,
        readiness,
        readinessError,
        retryInitialization,
      }}
    >
      {children}
    </SshForwardHostContext.Provider>
  );
}

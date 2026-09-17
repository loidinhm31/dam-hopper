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
  getNativeScopeIds,
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
    let sequence = 0;
    const knownScopes = () => {
      const result = readServerProfiles();
      return result.status === "available"
        ? getNativeScopeIds(result.profiles.map((profile) => profile.id))
        : result;
    };
    let openClientPromise: Promise<
      Awaited<ReturnType<SshForwardHost["openClient"]>>
    > | null = null;
    const ensureOpenClient = (refresh = false) => {
      if (refresh || !openClientPromise) {
        const nextOpenClient = host.openClient(knownScopes());
        let guardedOpenClient!: typeof nextOpenClient;
        guardedOpenClient = nextOpenClient.catch((error) => {
          if (openClientPromise === guardedOpenClient) openClientPromise = null;
          throw error;
        });
        openClientPromise = guardedOpenClient;
      }
      return openClientPromise;
    };
    const fail = (error: unknown) => {
      if (!disposed) setInitialization({ host, readiness: "failed", error });
    };
    const init = (refresh = false) => {
      const currentSeq = ++sequence;
      if (!disposed)
        setInitialization({ host, readiness: "initializing", error: null });
      ensureOpenClient(refresh)
        .then(() => {
          if (!disposed && currentSeq === sequence) {
            setInitialization({ host, readiness: "ready", error: null });
          }
        })
        .catch((error) => {
          if (currentSeq === sequence) fail(error);
        });
    };
    retryRef.current = () => {
      init(true);
      return Promise.resolve();
    };
    init();
    const unsubscribe = subscribeToProfileChanges((event) => {
      if (disposed) return;
      if (event.type === "profileListChanged") {
        const scopes = knownScopes();
        host.reconcileKnownScopes(scopes).catch(() => {});
      }
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
          const currentProfiles = readServerProfiles();
          if (currentProfiles.status !== "available") return;
          const currentKnownScopes = getNativeScopeIds(
            currentProfiles.profiles.map((profile) => profile.id),
          );
          if (currentKnownScopes.status !== "available") return;
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

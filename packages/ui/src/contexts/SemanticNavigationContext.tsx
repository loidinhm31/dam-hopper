import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getServerUrl } from "@/api/server-config.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useEditorStore } from "@/stores/editor.js";
import { useNavigationResultsStore } from "@/stores/navigation-results.js";
import {
  SemanticTransport,
  type SemanticTransportStatus,
} from "@/api/semantic-transport.js";
import { SemanticTrustApi } from "@/api/semantic-trust.js";
import { SemanticDocumentController } from "@/lib/semantic-document-controller.js";
import {
  SemanticPrewarmController,
  type PrewarmTransport,
} from "@/lib/semantic-prewarm.js";
import { semanticLanguageForFile } from "@/lib/semantic-language.js";
import type {
  SemanticDescriptorAvailability,
  SemanticNavigationRequest,
  SemanticNavigationResponse,
  SemanticNavigationTarget,
  SemanticTrustState,
  PrewarmIntent,
} from "@dam-hopper/shared";

export interface SemanticCancellationSignal {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose: () => void };
}

interface PendingNavigation {
  documentVersion: number;
  policyRevision: number;
  resolve: (targets: SemanticNavigationTarget[] | null) => void;
  cancelSubscription?: { dispose: () => void };
  timer: ReturnType<typeof setTimeout>;
}

interface SemanticNavigationContextValue {
  transport: SemanticTransport | null;
  trustApi: SemanticTrustApi | null;
  availability: SemanticDescriptorAvailability[];
  trust: SemanticTrustState | null;
  status: string;
  transportStatus: SemanticTransportStatus;
  projectReady: boolean;
  requestNavigation: (
    request: SemanticNavigationRequest,
    signal?: SemanticCancellationSignal,
  ) => Promise<SemanticNavigationTarget[] | null>;
  acceptTrustState: (state: SemanticTrustState) => void;
}

const SemanticNavigationContext =
  createContext<SemanticNavigationContextValue | null>(null);

export function SemanticNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const profile = useServerProfile();
  const profileId = profile?.id ?? null;
  const projectId = useWorkspaceStore((state) => state.activeProject);
  const tabs = useEditorStore((state) => state.tabs ?? []);
  const activeKeys = useEditorStore((state) => state.activeKeys ?? {});
  const getSemanticDocuments = useEditorStore(
    (state) => state.getSemanticDocuments ?? (() => []),
  );
  const activeTab = useMemo(() => {
    if (!projectId) return null;
    const key = activeKeys[projectId];
    return tabs.find((tab) => tab.key === key) ?? null;
  }, [activeKeys, projectId, tabs]);
  const activeTabKey = activeTab?.key;
  const activeTabHydrated = activeTab?.hydrated;
  const activeTabLoading = activeTab?.loading;
  const activeTabMime = activeTab?.mime;
  const activeTabPath = activeTab?.path;
  const activeTabGeneration = activeTab?.tabGeneration;
  const activeSemanticTab = useMemo(
    () =>
      activeTabKey == null
        ? null
        : {
            key: activeTabKey,
            hydrated: activeTabHydrated,
            loading: activeTabLoading,
            mime: activeTabMime,
            path: activeTabPath ?? "",
            tabGeneration: activeTabGeneration,
          },
    [
      activeTabGeneration,
      activeTabHydrated,
      activeTabKey,
      activeTabLoading,
      activeTabMime,
      activeTabPath,
    ],
  );
  const [transport, setTransport] = useState<SemanticTransport | null>(null);
  const [workspaceGeneration, setWorkspaceGeneration] = useState<number | null>(
    null,
  );
  useEffect(() => {
    if (!profileId || !profile?.url) {
      setTransport(null);
      return;
    }
    const next = new SemanticTransport({ baseUrl: profile.url, profileId });
    setTransport(next);
    return () => next.destroy();
  }, [profile?.url, profileId]);
  const trustApi = useMemo(
    () =>
      profileId
        ? new SemanticTrustApi(profile?.url ?? getServerUrl(), profileId)
        : null,
    [profile?.url, profileId],
  );
  const documents = useMemo(
    () => (transport ? new SemanticDocumentController(transport) : null),
    [transport],
  );
  const prewarm = useMemo<SemanticPrewarmController | null>(() => {
    if (!transport) return null;
    const adapter: PrewarmTransport = {
      prewarm: (intent: PrewarmIntent) =>
        transport.prewarm(
          intent.projectId,
          intent.language,
          intent.tabGeneration,
        ),
    };
    return new SemanticPrewarmController(adapter);
  }, [transport]);
  const [availability, setAvailability] = useState<
    SemanticDescriptorAvailability[]
  >([]);
  const [trust, setTrust] = useState<SemanticTrustState | null>(null);
  const [status, setStatus] = useState("disconnected");
  const [transportStatus, setTransportStatus] =
    useState<SemanticTransportStatus>("disconnected");
  const [projectReady, setProjectReady] = useState(false);
  const pending = useRef(new Map<string, PendingNavigation>());
  const projectRef = useRef(projectId);
  const trustRef = useRef<SemanticTrustState | null>(null);
  const semanticStatusRef = useRef(status);
  const projectReadyRef = useRef(projectReady);

  useEffect(() => {
    semanticStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    projectReadyRef.current = projectReady;
  }, [projectReady]);

  useEffect(() => {
    projectRef.current = projectId;
  }, [projectId]);

  const cancelPending = useCallback(() => {
    for (const [requestId, entry] of pending.current) {
      clearTimeout(entry.timer);
      entry.cancelSubscription?.dispose();
      transport?.cancel({
        requestId,
        documentVersion: entry.documentVersion,
      });
      useNavigationResultsStore.getState().clearRequest(requestId);
      entry.resolve(null);
      pending.current.delete(requestId);
    }
    useNavigationResultsStore.getState().clear();
  }, [transport]);

  const acceptTrustState = useCallback(
    (next: SemanticTrustState) => {
      if (next.projectId !== projectRef.current) return;
      const previous = trustRef.current;
      trustRef.current = next;
      setTrust(next);
      const policyChanged =
        previous !== null &&
        (previous.projectId !== next.projectId ||
          previous.trust !== next.trust ||
          previous.policyRevision !== next.policyRevision);
      if (policyChanged) {
        prewarm?.reset();
        cancelPending();
      }
    },
    [cancelPending, prewarm],
  );

  useEffect(() => {
    if (!transport || !documents || !prewarm) return;
    const offStatus = transport.onStatusChange((nextStatus) => {
      setTransportStatus(nextStatus);
      if (nextStatus !== "connected") setStatus(nextStatus);
      setProjectReady(transport.isProjectReady());
      projectReadyRef.current = transport.isProjectReady();
      if (!transport.isProjectReady()) prewarm.reset();
      if (nextStatus !== "connected") {
        setWorkspaceGeneration(null);
      }
    });
    const offMessage = transport.onMessage((message) => {
      if (message.kind === "semantic:handshake") {
        setWorkspaceGeneration(message.workspaceGeneration);
        setProjectReady(false);
        projectReadyRef.current = false;
        setAvailability(message.availability);
        const handshakeTrust =
          message.trust.find((item) => item.projectId === projectRef.current) ??
          null;
        trustRef.current = handshakeTrust;
        setTrust(handshakeTrust);
        if (projectRef.current) transport.selectProject(projectRef.current);
      } else if (message.kind === "semantic:project") {
        if (message.projectId !== projectRef.current) return;
        setProjectReady(true);
        projectReadyRef.current = true;
        setWorkspaceGeneration(message.workspaceGeneration);
        setStatus("connected");
        setAvailability(message.availability);
        acceptTrustState(message.trust);
        if (documents.snapshots(message.projectId).length > 0) {
          transport.dropPendingDocuments(message.projectId);
          documents.replay(message.projectId);
        }
      } else if (message.kind === "semantic:trust_changed") {
        acceptTrustState(message.trust);
      } else if (message.kind === "semantic:status") {
        if (message.projectId === projectRef.current) setStatus(message.state);
      } else if (message.kind === "semantic:replay") {
        if (
          message.projectId === projectRef.current &&
          projectReadyRef.current
        ) {
          documents.replay(message.projectId);
        }
      } else if (
        message.kind === "semantic:workspace_changed" ||
        message.kind === "semantic:closed"
      ) {
        cancelPending();
        setAvailability([]);
        setTrust(null);
        trustRef.current = null;
        transport.dropPendingDocuments(projectRef.current ?? "");
        setStatus("disconnected");
        setProjectReady(false);
        projectReadyRef.current = false;
        setWorkspaceGeneration(null);
        transport.invalidateSelection();
        prewarm.reset();
      } else if (isNavigationResponse(message)) {
        resolveNavigation(message);
      }
    });
    return () => {
      offStatus();
      offMessage();
      cancelPending();
      documents.dispose();
      prewarm.reset();
    };

    function resolveNavigation(message: SemanticNavigationResponse): void {
      const entry = pending.current.get(message.requestId);
      if (!entry || entry.documentVersion !== message.documentVersion) return;
      clearTimeout(entry.timer);
      entry.cancelSubscription?.dispose();
      pending.current.delete(message.requestId);
      if (message.policyRevision !== entry.policyRevision) {
        useNavigationResultsStore.getState().clearRequest(message.requestId);
        entry.resolve(null);
        return;
      }
      if (message.kind !== "targets") {
        useNavigationResultsStore.getState().clearRequest(message.requestId);
      }
      entry.resolve(message.kind === "targets" ? message.targets : null);
    }
  }, [
    acceptTrustState,
    cancelPending,
    documents,
    getSemanticDocuments,
    prewarm,
    profileId,
    transport,
  ]);

  useEffect(() => {
    if (!transport || !documents || !prewarm || !projectId || !profileId) {
      setAvailability([]);
      setTrust(null);
      trustRef.current = null;
      setStatus("disconnected");
      setTransportStatus("disconnected");
      setWorkspaceGeneration(null);
      prewarm?.reset();
      return;
    }
    setProjectReady(false);
    projectReadyRef.current = false;
    trustRef.current = null;
    transport.selectProject(projectId);
    return () => {
      cancelPending();
      prewarm.reset();
    };
  }, [cancelPending, documents, prewarm, profileId, projectId, transport]);

  useEffect(() => {
    if (!transport || !documents || !projectId || !profileId || !projectReady)
      return;
    documents.sync(getSemanticDocuments(projectId, profileId));
  }, [
    documents,
    getSemanticDocuments,
    profileId,
    projectId,
    projectReady,
    tabs,
    transport,
  ]);

  useEffect(() => {
    if (
      !prewarm ||
      !projectId ||
      !profileId ||
      !activeSemanticTab ||
      !projectReady ||
      workspaceGeneration === null
    ) {
      prewarm?.reset();
      return;
    }
    const language = semanticLanguageForFile(
      activeSemanticTab.mime,
      activeSemanticTab.path,
    );
    if (!language) {
      prewarm.reset();
      return;
    }
    const state = availability.find(
      (item) => item.language === language,
    )?.state;
    prewarm.schedule(
      {
        profileId,
        workspaceId: profileId,
        workspaceGeneration,
        projectId,
        language,
        tabGeneration: activeSemanticTab.tabGeneration ?? 1,
      },
      {
        supported: state === "ready" || state === "restricted",
        hydrated:
          activeSemanticTab.hydrated === true && !activeSemanticTab.loading,
        active: true,
      },
    );
    return () => prewarm.cancel();
  }, [
    activeSemanticTab,
    availability,
    prewarm,
    profileId,
    projectId,
    projectReady,
    workspaceGeneration,
  ]);

  const displayedTrust = trust?.projectId === projectId ? trust : null;
  const value = useMemo<SemanticNavigationContextValue>(
    () => ({
      transport,
      trustApi,
      availability,
      trust: displayedTrust,
      status,
      transportStatus,
      projectReady,
      acceptTrustState,
      requestNavigation: (request, signal) => {
        if (
          !transport ||
          !documents ||
          !profileId ||
          !projectId ||
          !displayedTrust ||
          displayedTrust.trust === "revoked" ||
          !transport.isProjectSelected(projectId) ||
          status === "unavailable" ||
          status === "crashed" ||
          semanticStatusRef.current === "unavailable" ||
          semanticStatusRef.current === "crashed" ||
          !availability.some(
            (item) =>
              item.language === request.uri.language &&
              (item.state === "ready" || item.state === "restricted"),
          ) ||
          signal?.isCancellationRequested
        ) {
          return Promise.resolve(null);
        }
        if (workspaceGeneration !== null && profileId && projectId) {
          prewarm?.navigate({
            profileId,
            workspaceId: profileId,
            workspaceGeneration,
            projectId,
            language: request.uri.language,
            tabGeneration: activeSemanticTab?.tabGeneration ?? 1,
          });
        }
        documents.flush(request.uri);
        const normalizedRequest = {
          ...request,
          documentVersion:
            documents.version(request.uri) ?? request.documentVersion,
        };
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            pending.current.delete(normalizedRequest.requestId);
            useNavigationResultsStore
              .getState()
              .clearRequest(normalizedRequest.requestId);
            resolve(null);
          }, 10_000);
          const entry: PendingNavigation = {
            documentVersion: normalizedRequest.documentVersion,
            policyRevision: displayedTrust.policyRevision,
            resolve,
            timer,
          };
          if (signal) {
            entry.cancelSubscription = signal.onCancellationRequested(() => {
              transport.cancel({
                requestId: normalizedRequest.requestId,
                documentVersion: normalizedRequest.documentVersion,
              });
              clearTimeout(timer);
              pending.current.delete(normalizedRequest.requestId);
              useNavigationResultsStore
                .getState()
                .clearRequest(normalizedRequest.requestId);
              resolve(null);
            });
          }
          pending.current.set(normalizedRequest.requestId, entry);
          if (!transport.navigate(normalizedRequest)) {
            clearTimeout(timer);
            entry.cancelSubscription?.dispose();
            pending.current.delete(normalizedRequest.requestId);
            useNavigationResultsStore
              .getState()
              .clearRequest(normalizedRequest.requestId);
            resolve(null);
          }
        });
      },
    }),
    [
      acceptTrustState,
      availability,
      displayedTrust,
      documents,
      prewarm,
      profileId,
      projectId,
      status,
      projectReady,
      transportStatus,
      workspaceGeneration,
      activeSemanticTab?.tabGeneration,
      transport,
      trustApi,
    ],
  );

  return (
    <SemanticNavigationContext.Provider value={value}>
      {children}
    </SemanticNavigationContext.Provider>
  );
}

export function useSemanticNavigation(): SemanticNavigationContextValue {
  const value = useContext(SemanticNavigationContext);
  if (!value) {
    throw new Error(
      "useSemanticNavigation must be used inside SemanticNavigationProvider",
    );
  }
  return value;
}

function isNavigationResponse(
  value: unknown,
): value is SemanticNavigationResponse {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "targets" ||
    kind === "empty" ||
    kind === "cancelled" ||
    kind === "stale" ||
    kind === "unavailable" ||
    kind === "error"
  );
}

import { useEffect, useRef, useState } from "react";
import type {
  ApiClient,
  PluginMetadataItem,
  ProjectRef,
  ServerProjectTarget,
} from "@/api/client.js";
import type { ProjectTargetSnapshot } from "@/stores/project-target.js";
import {
  getApi,
  isCurrentConnection,
  useConnectionSnapshot,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import { toServerProjectTarget } from "@/api/client.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import {
  createApiFrameSessionBackend,
  FrameSession,
  type FrameSessionState,
} from "./bridge-host.js";
import {
  ADVISOR_WORKSPACE_EXTENSION_V1,
  type AdvisorWorkspaceContext,
  type UiIntent,
} from "./bridge-validators.js";
import {
  buildVerifiedPluginDocument,
  type VerifiedPluginDocument,
} from "./plugin-document.js";
import { parsePluginMetadata } from "./use-plugin-navigation.js";
import type { PluginUnavailableReason } from "@/components/PluginUnavailableState.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type PluginHostModel =
  | { kind: "loading"; message: string }
  | {
      kind: "unavailable";
      reason: PluginUnavailableReason;
      detail?: string;
    }
  | {
      kind: "ready";
      ownerKey: string;
      authorityKey: string;
      metadata: PluginMetadataItem;
      document: VerifiedPluginDocument;
      session: FrameSession;
      frameState: FrameSessionState;
      frameDetail?: string;
    };

export interface UsePluginHostOptions {
  installationId: string;
  project?: ProjectRef | null;
  projectTarget?: ProjectTargetSnapshot | null;
  connection?: ConnectionSnapshot | null;
  visible?: boolean;
  onUiIntent?: (intent: UiIntent) => void;
}

export function usePluginHost(options: UsePluginHostOptions): {
  model: PluginHostModel;
  title: string;
} {
  const { installationId, visible = true, onUiIntent } = options;

  // Resolve project, target, connection from options or global stores
  const storeProject = useWorkspaceStore((state) => state.selectedProject);
  const activeProject = options.project !== undefined ? options.project : storeProject;

  const hookTarget = useProjectTarget(activeProject);
  const activeTarget = options.projectTarget !== undefined ? options.projectTarget : hookTarget;

  const hookConnection = useConnectionSnapshot(activeProject?.profileId ?? "");
  const activeConnection =
    options.connection !== undefined ? options.connection : hookConnection;

  const onUiIntentRef = useRef(onUiIntent);
  useEffect(() => {
    onUiIntentRef.current = onUiIntent;
  });

  const [lifecycleRevision, setLifecycleRevision] = useState(0);
  const [model, setModel] = useState<PluginHostModel>({
    kind: "loading",
    message: "Resolving plugin access…",
  });

  const sessionRef = useRef<FrameSession | null>(null);
  const currentAuthorityKeyRef = useRef<string | null>(null);
  const targetKey = JSON.stringify([
    activeTarget?.target.project ?? "",
    activeTarget?.target.worktreePath ?? null,
  ]);

  const ownerKey = activeConnection
    ? `${activeConnection.owner.generation}:${activeProject?.profileId ?? "no-prof"}`
    : "no-connection";

  // Synchronous owner-change fencing: revoke old session immediately
  /* eslint-disable react-hooks/refs */
  const lastOwnerKeyRef = useRef(ownerKey);
  if (lastOwnerKeyRef.current !== ownerKey) {
    lastOwnerKeyRef.current = ownerKey;
    if (sessionRef.current) {
      sessionRef.current.revoke("Plugin connection owner changed");
      sessionRef.current = null;
      currentAuthorityKeyRef.current = null;
    }
  }
  /* eslint-enable react-hooks/refs */

  // Subscribe to availability changes
  useEffect(() => {
    if (activeConnection?.status !== "connected") return;
    const api = getApi(activeConnection.owner);
    return api.transport.onEvent("plugin:availability.changed", () => {
      setLifecycleRevision((revision) => revision + 1);
    });
  }, [activeConnection?.owner.generation, activeConnection?.status]);

  // Update session visibility without repreparing host
  useEffect(() => {
    sessionRef.current?.setVisible(visible);
  }, [visible]);
  // Revoke session on component unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.revoke("Plugin host unmounted");
      sessionRef.current = null;
      currentAuthorityKeyRef.current = null;
    };
  }, []);

  // Main preparation effect
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (!activeProject || !activeProject.profileId || !activeTarget) {
      if (sessionRef.current) {
        sessionRef.current.revoke("No project selected");
        sessionRef.current = null;
        currentAuthorityKeyRef.current = null;
      }
      setModel({ kind: "unavailable", reason: "no-project" });
      return () => controller.abort();
    }
    if (activeConnection?.status !== "connected") {
      if (sessionRef.current) {
        sessionRef.current.revoke("Connection not connected");
        sessionRef.current = null;
        currentAuthorityKeyRef.current = null;
      }
      setModel({ kind: "unavailable", reason: "connection" });
      return () => controller.abort();
    }
    if (installationId.length === 0 || installationId.length > 128) {
      if (sessionRef.current) {
        sessionRef.current.revoke("Invalid plugin ID");
        sessionRef.current = null;
        currentAuthorityKeyRef.current = null;
      }
      setModel({ kind: "unavailable", reason: "not-visible" });
      return () => controller.abort();
    }

    const owner = activeConnection.owner;
    const api = getApi(owner);
    const target: ServerProjectTarget = toServerProjectTarget(activeTarget.target);
    const stillCurrent = () => active && isCurrentConnection(owner);

    const prepare = async () => {
      const isAdvisor =
        installationId === "evcrate.advisor" || installationId.startsWith("evcrate.advisor");

      // 1. Check for same-root / global-authority project selection update
      if (
        sessionRef.current &&
        sessionRef.current.state === "Ready" &&
        currentAuthorityKeyRef.current
      ) {
        try {
          const viewContext = await api.plugins.describeView({
            installationId,
            target,
          });
          if (!stillCurrent()) return;
          if (viewContext.authorityKey === currentAuthorityKeyRef.current) {
            // Same root/global authority: deliver selection update without recreation
            const nextContext: AdvisorWorkspaceContext = {
              revision:
                (sessionRef.current.currentWorkspaceContext?.revision ?? 1) + 1,
              authorityKey: viewContext.authorityKey,
              project: {
                projectId: viewContext.workspaceProject.projectId,
                label: viewContext.workspaceProject.label,
              },
              historyScope: viewContext.historyScope,
              contextScope: viewContext.contextScope,
              allowedOperations: viewContext.allowedOperations,
            };
            if (sessionRef.current.updateWorkspaceContext(nextContext)) {
              return;
            }
          }
        } catch {
          // If describeView failed, fall through to full teardown and recreate
        }
      }

      // Dispose prior session before preparing replacement
      if (sessionRef.current) {
        sessionRef.current.revoke("Plugin authority or target changed");
        sessionRef.current = null;
        currentAuthorityKeyRef.current = null;
      }

      setModel({ kind: "loading", message: "Checking plugin access…" });

      try {
        let metadata: PluginMetadataItem | undefined;
        let allowedOperations: string[] = [];
        let allowCurrentAccountPolicy = false;
        let authorityKey = "";
        let workspaceContext: AdvisorWorkspaceContext | undefined;
        let expectedContextScope: "history-root" | "project" | undefined;

        if (isAdvisor) {
          const viewContext = await api.plugins.describeView({
            installationId,
            target,
          });
          if (!stillCurrent()) return;
          metadata = viewContext.metadata;
          allowedOperations = viewContext.allowedOperations;
          allowCurrentAccountPolicy = viewContext.allowCurrentAccountPolicy;
          authorityKey = viewContext.authorityKey;
          expectedContextScope = viewContext.contextScope;
          workspaceContext = {
            revision: 1,
            authorityKey: viewContext.authorityKey,
            project: {
              projectId: viewContext.workspaceProject.projectId,
              label: viewContext.workspaceProject.label,
            },
            historyScope: viewContext.historyScope,
            contextScope: viewContext.contextScope,
            allowedOperations: viewContext.allowedOperations,
          };
        } else {
          // Generic plugin
          const response = await api.plugins.list(target);
          if (!stillCurrent()) return;
          const found = response.plugins
            .map(parsePluginMetadata)
            .find((item) => item?.id === installationId);
          if (found) {
            metadata = found;
            allowedOperations = found.capabilities;
            allowCurrentAccountPolicy = found.capabilities.includes("policy.readCurrent");
            authorityKey = `${found.id}:${found.activeDigest}:${found.activeGeneration}`;
          }
        }

        if (!metadata) {
          setModel({ kind: "unavailable", reason: "not-visible" });
          return;
        }
        if (!metadata.enabled) {
          setModel({ kind: "unavailable", reason: "disabled" });
          return;
        }
        if (!metadata.hasUi) {
          setModel({ kind: "unavailable", reason: "no-ui" });
          return;
        }
        if (
          !SHA256_PATTERN.test(metadata.activeDigest) ||
          !Number.isSafeInteger(metadata.activeGeneration) ||
          metadata.activeGeneration < 0
        ) {
          setModel({ kind: "unavailable", reason: "incompatible" });
          return;
        }

        const newSession = new FrameSession({
          installationId: metadata.id,
          activationGeneration: metadata.activeGeneration,
          target,
          allowedOperations,
          allowCurrentAccountPolicy,
          backend: createApiFrameSessionBackend(api),
          extension: isAdvisor ? ADVISOR_WORKSPACE_EXTENSION_V1 : undefined,
          workspaceContext,
          expectedContextScope,
          visible,
          onUiIntent: (intent) => onUiIntentRef.current?.(intent),
          onStateChange: (frameState, frameDetail) => {
            if (!active || sessionRef.current !== newSession) return;
            setModel((current) =>
              current.kind === "ready" && current.session === newSession
                ? { ...current, frameState, frameDetail }
                : current,
            );
          },
        });

        sessionRef.current = newSession;
        currentAuthorityKeyRef.current = authorityKey;

        setModel({ kind: "loading", message: "Verifying plugin interface…" });
        const asset = await api.plugins.readUiAsset(
          {
            installationId: metadata.id,
            activeDigest: metadata.activeDigest,
            activationGeneration: metadata.activeGeneration,
            target,
          },
          controller.signal,
        );

        if (!stillCurrent() || newSession.state === "Revoked") return;

        const document = await buildVerifiedPluginDocument({
          bytes: asset.bytes,
          expectedDigest: asset.sha256,
          frameSession: newSession.frameSession,
          activationGeneration: metadata.activeGeneration,
        });

        if (!stillCurrent()) return;

        setModel({
          kind: "ready",
          ownerKey,
          authorityKey,
          metadata,
          document,
          session: newSession,
          frameState: newSession.state,
        });
      } catch (error) {
        if (!stillCurrent() || controller.signal.aborted) return;
        sessionRef.current?.revoke("Plugin interface preparation failed");
        sessionRef.current = null;
        currentAuthorityKeyRef.current = null;
        setModel({
          kind: "unavailable",
          reason: "asset",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void prepare();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    activeConnection?.owner.generation,
    activeConnection?.status,
    activeProject?.profileId,
    installationId,
    lifecycleRevision,
    targetKey,
  ]);

  // Synchronous display masking: never display prior-key ready state for even one render
  let effectiveModel = model;
  if (model.kind === "ready" && model.ownerKey !== ownerKey) {
    effectiveModel = {
      kind: "loading",
      message: "Updating plugin access…",
    };
  }
  if (!activeProject || !activeProject.profileId || !activeTarget) {
    if (effectiveModel.kind !== "unavailable" || effectiveModel.reason !== "no-project") {
      effectiveModel = { kind: "unavailable", reason: "no-project" };
    }
  } else if (activeConnection?.status !== "connected") {
    if (effectiveModel.kind !== "unavailable" || effectiveModel.reason !== "connection") {
      effectiveModel = { kind: "unavailable", reason: "connection" };
    }
  } else if (installationId.length === 0 || installationId.length > 128) {
    if (effectiveModel.kind !== "unavailable" || effectiveModel.reason !== "not-visible") {
      effectiveModel = { kind: "unavailable", reason: "not-visible" };
    }
  }

  const title =
    effectiveModel.kind === "ready"
      ? effectiveModel.metadata.id === "evcrate.advisor" ||
        effectiveModel.metadata.publisher === "evcrate"
        ? "EVCrate Advisor"
        : effectiveModel.metadata.id
      : installationId === "evcrate.advisor"
        ? "EVCrate Advisor"
        : installationId || "Plugin";

  return { model: effectiveModel, title };
}

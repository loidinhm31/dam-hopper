import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useParams } from "react-router-dom";
import {
  getApi,
  isCurrentConnection,
  useConnectionSnapshot,
} from "@/api/connections.js";
import {
  toServerProjectTarget,
  type PluginMetadataItem,
  type ProjectRef,
} from "@/api/client.js";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import {
  createApiFrameSessionBackend,
  FrameSession,
  type FrameSessionState,
} from "@/plugins/bridge-host.js";
import {
  buildVerifiedPluginDocument,
  type VerifiedPluginDocument,
} from "@/plugins/plugin-document.js";
import { parsePluginMetadata } from "@/plugins/use-plugin-navigation.js";
import { PluginFrame } from "./PluginFrame.js";
import {
  PluginUnavailableState,
  type PluginUnavailableReason,
} from "./PluginUnavailableState.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type HostModel =
  | { kind: "loading"; message: string }
  | {
      kind: "unavailable";
      reason: PluginUnavailableReason;
      detail?: string;
    }
  | {
      kind: "ready";
      metadata: PluginMetadataItem;
      document: VerifiedPluginDocument;
      session: FrameSession;
      frameState: FrameSessionState;
      frameDetail?: string;
    };

export function PluginHostPage() {
  const { installationId = "" } = useParams<{ installationId: string }>();
  const project = useWorkspaceStore((state) => state.selectedProject);
  const projectTarget = useProjectTarget(project);
  const connection = useConnectionSnapshot(project?.profileId ?? "");
  const [lifecycleRevision, setLifecycleRevision] = useState(0);
  const [model, setModel] = useState<HostModel>({
    kind: "loading",
    message: "Resolving plugin access…",
  });
  const targetKey = JSON.stringify([
    projectTarget?.target.project ?? "",
    projectTarget?.target.worktreePath ?? null,
  ]);

  useEffect(() => {
    if (connection?.status !== "connected") return;
    const api = getApi(connection.owner);
    return api.transport.onEvent("plugin:availability.changed", () => {
      setLifecycleRevision((revision) => revision + 1);
    });
  }, [connection?.owner.generation, connection?.status]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let session: FrameSession | null = null;

    if (!project || !project.profileId || !projectTarget) {
      setModel({ kind: "unavailable", reason: "no-project" });
      return () => controller.abort();
    }
    if (connection?.status !== "connected") {
      setModel({ kind: "unavailable", reason: "connection" });
      return () => controller.abort();
    }
    if (installationId.length === 0 || installationId.length > 128) {
      setModel({ kind: "unavailable", reason: "not-visible" });
      return () => controller.abort();
    }

    const owner = connection.owner;
    const api = getApi(owner);
    const target = toServerProjectTarget(projectTarget.target);
    const stillCurrent = () => active && isCurrentConnection(owner);

    const prepare = async () => {
      setModel({ kind: "loading", message: "Checking plugin access…" });
      try {
        const response = await api.plugins.list(target);
        if (!stillCurrent()) return;
        const metadata = response.plugins
          .map(parsePluginMetadata)
          .find((item) => item?.id === installationId);
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

        session = new FrameSession({
          installationId: metadata.id,
          activationGeneration: metadata.activeGeneration,
          target,
          allowedOperations: metadata.capabilities,
          allowCurrentAccountPolicy:
            metadata.capabilities.includes("policy.readCurrent"),
          backend: createApiFrameSessionBackend(api),
          onStateChange: (frameState, frameDetail) => {
            if (!active || !session) return;
            setModel((current) =>
              current.kind === "ready" && current.session === session
                ? { ...current, frameState, frameDetail }
                : current,
            );
          },
        });
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
        if (!stillCurrent() || session.state === "Revoked") return;
        const document = await buildVerifiedPluginDocument({
          bytes: asset.bytes,
          expectedDigest: asset.sha256,
          frameSession: session.frameSession,
          activationGeneration: metadata.activeGeneration,
        });
        if (!stillCurrent()) return;
        setModel({
          kind: "ready",
          metadata,
          document,
          session,
          frameState: session.state,
        });
      } catch (error) {
        if (!stillCurrent() || controller.signal.aborted) return;
        session?.revoke("Plugin interface preparation failed");
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
      session?.revoke("Plugin owner or target changed");
    };
  }, [
    connection?.owner.generation,
    connection?.status,
    installationId,
    lifecycleRevision,
    project?.profileId,
    targetKey,
  ]);

  const title =
    model.kind === "ready"
      ? (model.metadata.id === "evcrate.advisor" || model.metadata.publisher === "evcrate"
          ? "EVCrate Advisor"
          : model.metadata.id)
      : (installationId === "evcrate.advisor" ? "EVCrate Advisor" : (installationId || "Plugin"));
  return (
    <AppLayout title={`Plugin · ${title}`}>
      <div className="plugin-host-page">
        {model.kind === "loading" ? (
          <div className="plugin-host-loading" role="status" aria-live="polite">
            <LoaderCircle
              className="h-5 w-5 animate-spin text-[var(--color-primary)]"
              aria-hidden="true"
            />
            <span>{model.message}</span>
          </div>
        ) : model.kind === "unavailable" ? (
          <PluginUnavailableState reason={model.reason} detail={model.detail} />
        ) : model.frameState === "Revoked" ? (
          <PluginUnavailableState reason="bridge" detail={model.frameDetail} />
        ) : (
          <PluginFrame
            session={model.session}
            srcdoc={model.document.srcdoc}
            title={`${model.metadata.id} ${model.metadata.version}`}
            state={model.frameState}
          />
        )}
      </div>
    </AppLayout>
  );
}

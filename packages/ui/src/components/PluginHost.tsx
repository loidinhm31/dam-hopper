import { LoaderCircle } from "lucide-react";
import { clsx } from "clsx";
import type { ProjectRef } from "@/api/client.js";
import type { ProjectTargetSnapshot } from "@/stores/project-target.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { UiIntent } from "@/plugins/bridge-validators.js";
import { usePluginHost } from "@/plugins/use-plugin-host.js";
import { PluginFrame } from "./PluginFrame.js";
import { PluginUnavailableState } from "./PluginUnavailableState.js";

export interface PluginHostProps {
  installationId: string;
  project?: ProjectRef | null;
  projectTarget?: ProjectTargetSnapshot | null;
  connection?: ConnectionSnapshot | null;
  visible?: boolean;
  onUiIntent?: (intent: UiIntent) => void;
  className?: string;
  titleOverride?: string;
}

export function PluginHost({
  installationId,
  project,
  projectTarget,
  connection,
  visible = true,
  onUiIntent,
  className,
  titleOverride,
}: PluginHostProps) {
  const { model, title } = usePluginHost({
    installationId,
    project,
    projectTarget,
    connection,
    visible,
    onUiIntent,
  });

  return (
    <div className={clsx("plugin-host-page", className)}>
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
          title={titleOverride ?? title}
          state={model.frameState}
        />
      )}
    </div>
  );
}

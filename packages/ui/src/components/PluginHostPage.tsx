import { useParams } from "react-router-dom";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { PluginHost } from "./PluginHost.js";
import { PluginUnavailableState } from "./PluginUnavailableState.js";

export function PluginHostPage() {
  const { installationId = "" } = useParams<{ installationId: string }>();

  if (installationId === "evcrate.advisor") {
    return (
      <AppLayout title="Plugin · Unavailable">
        <div className="plugin-host-page">
          <PluginUnavailableState reason="not-visible" />
        </div>
      </AppLayout>
    );
  }

  const title = installationId || "Plugin";

  return (
    <AppLayout title={`Plugin · ${title}`}>
      <PluginHost installationId={installationId} />
    </AppLayout>
  );
}

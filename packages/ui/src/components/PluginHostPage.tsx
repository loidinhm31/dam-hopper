import { useParams } from "react-router-dom";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { PluginHost } from "./PluginHost.js";

export function PluginHostPage() {
  const { installationId = "" } = useParams<{ installationId: string }>();
  const title =
    installationId === "evcrate.advisor"
      ? "EVCrate Advisor"
      : (installationId || "Plugin");

  return (
    <AppLayout title={`Plugin · ${title}`}>
      <PluginHost installationId={installationId} />
    </AppLayout>
  );
}

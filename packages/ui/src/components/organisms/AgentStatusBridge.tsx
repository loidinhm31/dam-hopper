import { useAgentStatusConnections } from "@/hooks/use-agent-status-connections.js";

/** Keep per-profile status watches alive across routes and unmounted terminals. */
export function AgentStatusBridge(): null {
  useAgentStatusConnections();
  return null;
}

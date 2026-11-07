import {
  getConnectionSnapshot,
  getApi,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ApiClient } from "@/api/client.js";
import { SessionChangesClient } from "@/api/session-changes-client.js";
import type { ReviewTarget } from "@/api/terminal-session-contract.js";
import { createIntent, dispatchIntent } from "../intents.js";
import type { AgentHubItem } from "../agent-hub.js";

export interface RequestAgentHubReviewResult {
  readonly ok: boolean;
  readonly notice?: string;
}

export interface SessionChangesStatusResponse {
  readonly terminalIncarnation?: string;
  readonly state?: string;
  readonly rootId?: string;
  readonly baselineId?: string;
  readonly serverEpoch?: string;
}

export interface RequestAgentHubReviewDependencies {
  getConnectionSnapshot?: (profileId: string) => ConnectionSnapshot | null;
  getApi?: (owner: ConnectionRef) => {
    config: {
      get(): Promise<{ server?: { sessionChangesEnabled?: boolean } } | null>;
    };
  };
  createSessionChangesClient?: (options: { apiClient: unknown }) => {
    getStatus(params: {
      terminalId: string;
      terminalIncarnation: string;
      ompSessionId: string;
    }): Promise<SessionChangesStatusResponse>;
  };
  dispatchIntent?: typeof dispatchIntent;
  createIntent?: typeof createIntent;
}

export async function requestAgentHubReview(
  item: AgentHubItem,
  sourceWindowId: string,
  deps?: RequestAgentHubReviewDependencies,
): Promise<RequestAgentHubReviewResult> {
  // Verify exact agent evidence join
  if (!item.isAgent || !item.status || !item.terminationTarget) {
    return {
      ok: false,
      notice:
        "Review unavailable: Agent evidence proof missing or unsafe numeric incarnation.",
    };
  }

  const getSnapshot = deps?.getConnectionSnapshot ?? getConnectionSnapshot;
  const getApiClient = deps?.getApi ?? getApi;
  const createScClient =
    deps?.createSessionChangesClient ??
    ((opts: { apiClient: ApiClient }) =>
      new SessionChangesClient({ apiClient: opts.apiClient }));
  const dispatch = deps?.dispatchIntent ?? dispatchIntent;
  const makeIntent = deps?.createIntent ?? createIntent;

  const snap = getSnapshot(item.profileId);
  if (!snap || snap.status !== "connected") {
    return {
      ok: false,
      notice: `Review unavailable: Target profile "${item.profileLabel}" is disconnected.`,
    };
  }

  if (snap.owner.generation !== item.terminationTarget.generation) {
    return {
      ok: false,
      notice: `Review unavailable: Target profile generation changed (expected ${item.terminationTarget.generation}, live ${snap.owner.generation}).`,
    };
  }

  const client = getApiClient(snap.owner);

  try {
    const config = await client.config.get();
    if (!config?.server?.sessionChangesEnabled) {
      return {
        ok: false,
        notice:
          "Review unavailable: Session changes tracking is disabled on server. Enable it in Server Settings.",
      };
    }

    const scClient = createScClient({ apiClient: client as unknown as ApiClient });
    const status = await scClient.getStatus({
      terminalId: item.terminationTarget.terminalId,
      terminalIncarnation: item.terminationTarget.incarnation,
      ompSessionId: item.status.agentSessionId ?? "",
    });

    // Recheck currency post-await
    const postSnap = getSnapshot(item.profileId);
    if (
      !postSnap ||
      postSnap.status !== "connected" ||
      postSnap.owner.generation !== item.terminationTarget.generation
    ) {
      return {
        ok: false,
        notice:
          "Review unavailable: Connection retired or changed during status resolution.",
      };
    }

    // Exact terminal incarnation comparison
    if (status.terminalIncarnation !== item.terminationTarget.incarnation) {
      return {
        ok: false,
        notice: `Review unavailable: Incarnation mismatch (status ${status.terminalIncarnation}, target ${item.terminationTarget.incarnation}).`,
      };
    }

    if (status.state === "initializing") {
      return {
        ok: false,
        notice:
          "Review unavailable: Session changes is currently initializing for this session.",
      };
    }

    if (!status.rootId || !status.baselineId) {
      return {
        ok: false,
        notice:
          "Review unavailable: No session changes baseline has been established yet.",
      };
    }

    if (!status.serverEpoch) {
      return {
        ok: false,
        notice:
          "Review unavailable: Missing server epoch in session changes status.",
      };
    }

    if (
      item.terminationTarget.serverEpoch &&
      status.serverEpoch !== item.terminationTarget.serverEpoch
    ) {
      return {
        ok: false,
        notice: `Review unavailable: Server epoch mismatch (status ${status.serverEpoch}, target ${item.terminationTarget.serverEpoch}).`,
      };
    }

    const reviewTarget: ReviewTarget = Object.freeze({
      profileId: item.terminationTarget.profileId,
      generation: item.terminationTarget.generation,
      terminalId: item.terminationTarget.terminalId,
      terminalIncarnation: item.terminationTarget.incarnation,
      ompSessionId: item.status.agentSessionId ?? "",
      serverEpoch: status.serverEpoch,
      rootId: status.rootId,
      baselineId: status.baselineId,
    });

    dispatch(makeIntent("session-changes:open", reviewTarget, sourceWindowId));
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      notice: `Review unavailable: ${msg}`,
    };
  }
}

/**
 * Typed OS Intent routing for DamHopper OS.
 *
 * Defines explicit typed actions for cross-app coordination.
 * Unknown or unimplemented intents yield safe notices/no-ops without
 * side-effects or process reuse.
 */

export type IntentAction =
  | "terminal:open"
  | "terminal:focus"
  | "file:open"
  | "file:edit"
  | "file:reveal"
  | "browser:preview"
  | "browser:open"
  | "search:query"
  | "changes:stage"
  | "changes:unstage"
  | "changes:discard"
  | "changes:commit"
  | "changes:diff"
  | "git:status"
  | "git:diff"
  | "git:history"
  | "git:branch"
  | "git:reveal-commit"
  | "conflict:resolve"
  | "conflict:reveal"
  | "session-changes:open"
  | "workflow:open-item"
  | "workflow:open-plan"
  | "ports:open"
  | "ports:open-tunnel"
  | "project:info"
  | "project:config"
  | "agent-store:open"
  | "settings:open"
  | "settings:devices"
  | "system:monitor"
  | "recipes:launch";

export interface IntentPayloadMap {
  "terminal:open": {
    profileId: string;
    projectId?: string;
    worktreeId?: string;
    cwd?: string;
  };
  "terminal:focus": {
    profileId: string;
    terminalId: string;
  };
  "file:open": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    filePath: string;
    line?: number;
    generation?: number;
  };
  "file:edit": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    filePath: string;
    line?: number;
  };
  "file:reveal": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    filePath: string;
  };
  "browser:preview": {
    profileId: string;
    url: string;
  };
  "browser:open": {
    profileId: string;
    url: string;
  };
  "git:status": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
  };
  "git:diff": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    commitOid?: string;
  };
  "git:history": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
  };
  "git:branch": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    branchName?: string;
  };
  "git:reveal-commit": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    commitHash: string;
    rootId?: string;
  };
  "search:query": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    query: string;
  };
  "changes:stage": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    path: string;
  };
  "changes:unstage": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    path: string;
  };
  "changes:discard": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    path: string;
  };
  "changes:commit": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    message?: string;
  };
  "changes:diff": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    filePath: string;
    status?: string;
    additions?: number;
    deletions?: number;
    gitRootId?: string;
    diffPath?: string;
  };
  "conflict:resolve": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    operation?: string;
    root?: string;
    filePath?: string;
  };
  "conflict:reveal": {
    profileId: string;
    projectId: string;
    worktreeId?: string;
    filePath: string;
  };
  "session-changes:open": {
    profileId: string;
    generation?: number;
    terminalId: string;
    terminalIncarnation: string;
    ompSessionId: string;
    rootId?: string;
  };
  "workflow:open-item": {
    profileId: string;
    projectId?: string;
    itemId: string;
  };
  "workflow:open-plan": {
    profileId: string;
    projectId?: string;
    planId: string;
  };
  "ports:open": {
    profileId: string;
  };
  "ports:open-tunnel": {
    profileId: string;
    url: string;
  };
  "project:info": {
    profileId: string;
    projectId: string;
  };
  "project:config": {
    profileId: string;
    projectId: string;
  };
  "agent-store:open": {
    profileId: string;
    tab?: string;
  };
  "settings:open": {
    profileId?: string;
    tab?: string;
  };
  "settings:devices": {
    profileId?: string;
  };
  "system:monitor": {
    profileId: string;
  };
  "recipes:launch": {
    profileId: string;
    recipeId: string;
  };
}

export interface OsIntent<K extends IntentAction = IntentAction> {
  action: K;
  payload: IntentPayloadMap[K];
  sourceWindowId?: string;
  timestamp: number;
}

export type IntentResult =
  | { status: "handled"; targetWindowId?: string }
  | { status: "unhandled"; reason: string }
  | { status: "invalid"; error: string };

export type IntentHandler<K extends IntentAction = IntentAction> = (
  intent: OsIntent<K>,
) => Promise<IntentResult> | IntentResult;

class IntentRouter {
  private handlers = new Map<IntentAction, Set<IntentHandler<any>>>();

  public register<K extends IntentAction>(
    action: K,
    handler: IntentHandler<K>,
  ): () => void {
    let set = this.handlers.get(action);
    if (!set) {
      set = new Set();
      this.handlers.set(action, set);
    }
    set.add(handler);

    return () => {
      const active = this.handlers.get(action);
      if (active) {
        active.delete(handler);
        if (active.size === 0) {
          this.handlers.delete(action);
        }
      }
    };
  }

  public async dispatch<K extends IntentAction>(
    intent: OsIntent<K>,
  ): Promise<IntentResult> {
    if (!intent || !intent.action || typeof intent.action !== "string") {
      return { status: "invalid", error: "Malformed intent object" };
    }

    const set = this.handlers.get(intent.action);
    if (!set || set.size === 0) {
      return {
        status: "unhandled",
        reason: `No catalog handler registered for intent '${intent.action}'. Safe no-op.`,
      };
    }

    let lastUnhandledReason = `No active handler processed intent '${intent.action}'.`;
    for (const handler of set) {
      try {
        const result = await handler(intent);
        if (result.status === "handled") {
          return result;
        }
        if (result.status === "invalid") {
          return result;
        }
        lastUnhandledReason = result.reason;
      } catch (err) {
        return {
          status: "invalid",
          error: `Intent handler threw an exception: ${String(err)}`,
        };
      }
    }

    return {
      status: "unhandled",
      reason: lastUnhandledReason,
    };
  }
  public clear(): void {
    this.handlers.clear();
  }
}

export const globalIntentRouter = new IntentRouter();

export function registerIntentHandler<K extends IntentAction>(
  action: K,
  handler: IntentHandler<K>,
): () => void {
  return globalIntentRouter.register(action, handler);
}

export function dispatchIntent<K extends IntentAction>(
  intent: OsIntent<K>,
): Promise<IntentResult> {
  return globalIntentRouter.dispatch(intent);
}

export function createIntent<K extends IntentAction>(
  action: K,
  payload: IntentPayloadMap[K],
  sourceWindowId?: string,
): OsIntent<K> {
  return {
    action,
    payload,
    sourceWindowId,
    timestamp: Date.now(),
  };
}

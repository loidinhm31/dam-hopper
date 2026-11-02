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
  | "browser:preview"
  | "browser:open"
  | "git:status"
  | "git:diff"
  | "git:history"
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
  };
  "file:edit": {
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

    // Execute first registered handler
    for (const handler of set) {
      try {
        const result = await handler(intent);
        return result;
      } catch (err) {
        return {
          status: "invalid",
          error: `Intent handler threw an exception: ${String(err)}`,
        };
      }
    }

    return {
      status: "unhandled",
      reason: `No active handler processed intent '${intent.action}'.`,
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

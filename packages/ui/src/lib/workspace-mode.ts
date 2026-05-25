export type WorkspaceMode = "ide" | "terminal";

const WORKSPACE_MODE_KEY = "dam-hopper:workspace-mode";
const DEFAULT_WORKSPACE_MODE: WorkspaceMode = "ide";

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === "ide" || value === "terminal";
}

export function loadWorkspaceMode(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): WorkspaceMode {
  try {
    const value = storage?.getItem(WORKSPACE_MODE_KEY);
    return isWorkspaceMode(value) ? value : DEFAULT_WORKSPACE_MODE;
  } catch {
    return DEFAULT_WORKSPACE_MODE;
  }
}

export function saveWorkspaceMode(
  mode: WorkspaceMode,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
) {
  try {
    storage?.setItem(WORKSPACE_MODE_KEY, mode);
  } catch {}
}


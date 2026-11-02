import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { OsWindow } from "./types.js";
import {
  useConnectionSnapshot,
  getConnectionSnapshot,
  type ConnectionStatus,
} from "@/api/connections.js";
import { readServerProfiles } from "@/api/server-config.js";

export interface WindowOwnerIdentity {
  profileId: string;
  generation: number;
  status: ConnectionStatus;
  isConnected: boolean;
  targetValid: boolean;
  repairAffordance?: string;
  projectId?: string;
  worktreeId?: string;
}
export interface WindowContextValue {
  window: OsWindow;
  owner: WindowOwnerIdentity;
  isFocused: boolean;
  isActiveDesktop: boolean;
  fencedAction: <T>(action: () => Promise<T> | T) => Promise<T | undefined>;
}
const OsWindowContext = createContext<WindowContextValue | null>(null);

export interface WindowContextProviderProps {
  window: OsWindow;
  isFocused: boolean;
  isActiveDesktop: boolean;
  children: ReactNode;
}

export function WindowContextProvider({
  window,
  isFocused,
  isActiveDesktop,
  children,
}: WindowContextProviderProps) {
  const snap = useConnectionSnapshot(window.ctx.profileId);
  const generation = snap?.owner.generation ?? 1;
  const status = snap?.status ?? "disconnected";
  const isConnected = status === "connected";

  // Validate target profile existence
  const known = readServerProfiles();
  const isProfileKnown =
    window.ctx.profileId === "default" ||
    (known.status === "available" &&
      known.profiles.some((p) => p.id === window.ctx.profileId));
  const targetValid = isProfileKnown;
  const repairAffordance = !isProfileKnown
    ? `Target server profile '${window.ctx.profileId}' not found. Window state preserved in read-only mode.`
    : undefined;

  const fencedAction = useMemo(() => {
    return async <T,>(action: () => Promise<T> | T): Promise<T | undefined> => {
      const capturedGen = generation;
      const capturedProfile = window.ctx.profileId;
      const currentSnap = getConnectionSnapshot(capturedProfile);
      if (
        !currentSnap ||
        currentSnap.status !== "connected" ||
        currentSnap.owner.generation !== capturedGen
      ) {
        return undefined;
      }
      const result = await action();
      const postSnap = getConnectionSnapshot(capturedProfile);
      if (
        !postSnap ||
        postSnap.status !== "connected" ||
        postSnap.owner.generation !== capturedGen
      ) {
        return undefined;
      }
      return result;
    };
  }, [generation, window.ctx.profileId]);

  const value = useMemo<WindowContextValue>(() => {
    return {
      window,
      owner: {
        profileId: window.ctx.profileId,
        generation,
        status,
        isConnected,
        targetValid,
        repairAffordance,
        projectId: window.ctx.projectId,
        worktreeId: window.ctx.worktreeId,
      },
      isFocused,
      isActiveDesktop,
      fencedAction,
    };
  }, [
    window,
    generation,
    status,
    isConnected,
    targetValid,
    repairAffordance,
    isFocused,
    isActiveDesktop,
    fencedAction,
  ]);
  return (
    <OsWindowContext.Provider value={value}>
      {children}
    </OsWindowContext.Provider>
  );
}

export function useWindowContext(): WindowContextValue {
  const ctx = useContext(OsWindowContext);
  if (!ctx) {
    throw new Error(
      "useWindowContext must be used within a WindowContextProvider",
    );
  }
  return ctx;
}

export function useWindowOwner(): WindowOwnerIdentity {
  return useWindowContext().owner;
}

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { OsWindow } from "./types.js";
import { useConnectionSnapshot, type ConnectionStatus } from "@/api/connections.js";

export interface WindowOwnerIdentity {
  profileId: string;
  generation: number;
  status: ConnectionStatus;
  isConnected: boolean;
  projectId?: string;
  worktreeId?: string;
}

export interface WindowContextValue {
  window: OsWindow;
  owner: WindowOwnerIdentity;
  isFocused: boolean;
  isActiveDesktop: boolean;
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

  const value = useMemo<WindowContextValue>(() => {
    return {
      window,
      owner: {
        profileId: window.ctx.profileId,
        generation,
        status,
        isConnected,
        projectId: window.ctx.projectId,
        worktreeId: window.ctx.worktreeId,
      },
      isFocused,
      isActiveDesktop,
    };
  }, [window, generation, status, isConnected, isFocused, isActiveDesktop]);
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

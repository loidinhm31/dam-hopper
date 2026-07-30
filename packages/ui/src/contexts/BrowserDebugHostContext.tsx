import { createContext, useContext, type ReactNode } from "react";
import type { BrowserDebugHost } from "@/lib/browser-debug-host.js";

export interface BrowserDebugHostEnvironment {
  kind: "web" | "native";
  platform?: string;
  experimental?: boolean;
}

export interface BrowserDebugHostContextValue {
  host: BrowserDebugHost | null;
  environment: BrowserDebugHostEnvironment;
}

const DEFAULT_CONTEXT: BrowserDebugHostContextValue = {
  host: null,
  environment: { kind: "web" },
};

const BrowserDebugHostContext = createContext(DEFAULT_CONTEXT);

export function BrowserDebugHostProvider({
  host,
  environment,
  children,
}: BrowserDebugHostContextValue & { children: ReactNode }) {
  return (
    <BrowserDebugHostContext.Provider value={{ host, environment }}>
      {children}
    </BrowserDebugHostContext.Provider>
  );
}

export function useBrowserDebugHost(): BrowserDebugHostContextValue {
  return useContext(BrowserDebugHostContext);
}

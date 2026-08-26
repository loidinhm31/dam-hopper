import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  installAndroidChromeInputPolicy,
  isAndroidChrome,
} from "@/lib/android-chrome-input-policy.js";

interface AndroidChromeInputPolicyContextValue {
  isAndroidChromeNativeInputSuppressed: boolean;
}

const AndroidChromeInputPolicyContext =
  createContext<AndroidChromeInputPolicyContextValue>({
    isAndroidChromeNativeInputSuppressed: false,
  });
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AndroidChromeInputPolicyProvider({
  children,
}: {
  children: ReactNode;
}) {
  const isAndroidChromeNativeInputSuppressed = useMemo(
    () => isAndroidChrome(),
    [],
  );

  useIsomorphicLayoutEffect(() => {
    if (!isAndroidChromeNativeInputSuppressed) return undefined;
    return installAndroidChromeInputPolicy();
  }, [isAndroidChromeNativeInputSuppressed]);

  const value = useMemo(
    () => ({ isAndroidChromeNativeInputSuppressed }),
    [isAndroidChromeNativeInputSuppressed],
  );
  return (
    <AndroidChromeInputPolicyContext.Provider value={value}>
      {children}
    </AndroidChromeInputPolicyContext.Provider>
  );
}

export function useAndroidChromeInputPolicy(): AndroidChromeInputPolicyContextValue {
  return useContext(AndroidChromeInputPolicyContext);
}

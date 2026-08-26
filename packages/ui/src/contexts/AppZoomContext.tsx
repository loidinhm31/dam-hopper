import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  APP_ZOOM_CHANGE_EVENT,
  APP_ZOOM_MAX,
  APP_ZOOM_MIN,
  DEFAULT_APP_ZOOM_LEVEL,
  isAppZoomLevel,
  loadAppZoom,
  saveAppZoom,
  stepAppZoom,
} from "@/lib/app-zoom.js";
import type { AppZoomDirection, AppZoomLevel } from "@/lib/app-zoom.js";

export interface AppZoomContextValue {
  level: AppZoomLevel;
  canDecrease: boolean;
  canIncrease: boolean;
  setLevel: (level: AppZoomLevel) => void;
  step: (direction: AppZoomDirection) => void;
}

const DEFAULT_CONTEXT: AppZoomContextValue = {
  level: DEFAULT_APP_ZOOM_LEVEL,
  canDecrease: true,
  canIncrease: true,
  setLevel: () => {},
  step: () => {},
};

const AppZoomContext = createContext(DEFAULT_CONTEXT);
const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AppZoomProvider({ children }: { children: ReactNode }) {
  const [level, setLevelState] = useState<AppZoomLevel>(() => loadAppZoom());
  const previousRootStyles = useRef<{
    zoom: string;
    appZoom: string;
  } | null>(null);

  const setLevel = useCallback((nextLevel: AppZoomLevel) => {
    if (isAppZoomLevel(nextLevel)) setLevelState(nextLevel);
  }, []);

  const step = useCallback((direction: AppZoomDirection) => {
    setLevelState((currentLevel) => stepAppZoom(currentLevel, direction));
  }, []);

  useClientLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!root) return;

    if (previousRootStyles.current === null) {
      previousRootStyles.current = {
        zoom: root.style.zoom,
        appZoom: root.style.getPropertyValue("--app-zoom"),
      };
    }
    root.style.zoom = `${level}%`;
    root.style.setProperty("--app-zoom", String(level / 100));
    saveAppZoom(level);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(APP_ZOOM_CHANGE_EVENT));
    }

    return () => {
      const previous = previousRootStyles.current;
      if (!previous) return;

      root.style.zoom = previous.zoom;
      if (previous.appZoom) {
        root.style.setProperty("--app-zoom", previous.appZoom);
      } else {
        root.style.removeProperty("--app-zoom");
      }
    };
  }, [level]);

  const value: AppZoomContextValue = {
    level,
    canDecrease: level > APP_ZOOM_MIN,
    canIncrease: level < APP_ZOOM_MAX,
    setLevel,
    step,
  };

  return (
    <AppZoomContext.Provider value={value}>{children}</AppZoomContext.Provider>
  );
}

export function useAppZoom(): AppZoomContextValue {
  return useContext(AppZoomContext);
}

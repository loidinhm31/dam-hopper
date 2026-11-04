import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type {
  ModalMountToken,
  ShellInputState,
  ShellModalCallbacks,
  ShellModalSurface,
  ShellNamedSurface,
  ShellNonmodalSurface,
} from "./types.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";

export interface ShellInputContextValue
  extends ShellInputState,
    ShellModalCallbacks {
  readonly isTerminalSuppressed: boolean;
  readonly closeActiveNonmodal: () => void;
}

const ShellInputContext = createContext<ShellInputContextValue | null>(null);

export interface ShellInputProviderProps {
  children: ReactNode;
  activePalette?: boolean;
  onPaletteChange?: (open: boolean) => void;
  activeNonmodal?: ShellNonmodalSurface | null;
  onNonmodalChange?: (surface: ShellNonmodalSurface | null) => void;
  onModalDepthChange?: (depth: number) => void;
}

export function ShellInputProvider({
  children,
  activePalette: controlledPalette,
  onPaletteChange,
  activeNonmodal: controlledNonmodal,
  onNonmodalChange,
  onModalDepthChange,
}: ShellInputProviderProps) {
  const cognitoActive = useCognitoModeStore((state) => state.active);

  const [uncontrolledNonmodal, setUncontrolledNonmodal] =
    useState<ShellNonmodalSurface | null>(null);
  const [uncontrolledPalette, setUncontrolledPalette] = useState(false);

  const activeNonmodal =
    controlledNonmodal !== undefined ? controlledNonmodal : uncontrolledNonmodal;
  const activePalette =
    controlledPalette !== undefined ? controlledPalette : uncontrolledPalette;

  const [activeModalTokens, setActiveModalTokens] = useState<
    readonly ModalMountToken[]
  >([]);

  useEffect(() => {
    onModalDepthChange?.(activeModalTokens.length);
  }, [activeModalTokens.length, onModalDepthChange]);

  const tokenCounterRef = useRef(0);

  const setSurfaceOpen = useCallback(
    (surface: ShellNamedSurface, open: boolean) => {
      if (surface === "command-palette") {
        if (onPaletteChange) {
          onPaletteChange(open);
        } else {
          setUncontrolledPalette(open);
        }
        return;
      }

      const nonmodalSurfaces: ShellNonmodalSurface[] = [
        "target-selector",
        "window-list",
        "notification-center",
      ];

      if (nonmodalSurfaces.includes(surface as ShellNonmodalSurface)) {
        const next = open ? (surface as ShellNonmodalSurface) : null;
        if (onNonmodalChange) {
          onNonmodalChange(next);
        } else {
          setUncontrolledNonmodal(next);
        }
      }
    },
    [onPaletteChange, onNonmodalChange],
  );

  const registerModalMount = useCallback((surface: ShellModalSurface) => {
    tokenCounterRef.current += 1;
    const token: ModalMountToken = `${surface}-${tokenCounterRef.current}-${Date.now()}`;
    setActiveModalTokens((prev) => [...prev, token]);

    return () => {
      setActiveModalTokens((prev) => prev.filter((t) => t !== token));
    };
  }, []);

  const closeActiveNonmodal = useCallback(() => {
    if (onNonmodalChange) {
      onNonmodalChange(null);
    } else {
      setUncontrolledNonmodal(null);
    }
  }, [onNonmodalChange]);

  const modalDepth = activeModalTokens.length;
  const isTerminalSuppressed =
    cognitoActive || activePalette || modalDepth > 0 || activeNonmodal !== null;

  const contextValue = useMemo<ShellInputContextValue>(
    () => ({
      cognitoActive,
      activeNonmodal,
      activePalette,
      modalDepth,
      activeModalTokens,
      isTerminalSuppressed,
      setSurfaceOpen,
      registerModalMount,
      closeActiveNonmodal,
    }),
    [
      cognitoActive,
      activeNonmodal,
      activePalette,
      modalDepth,
      activeModalTokens,
      isTerminalSuppressed,
      setSurfaceOpen,
      registerModalMount,
      closeActiveNonmodal,
    ],
  );

  return (
    <ShellInputContext.Provider value={contextValue}>
      {children}
    </ShellInputContext.Provider>
  );
}

const NOOP_UNREGISTER = () => {};
const DEFAULT_REGISTER_MODAL_MOUNT = () => NOOP_UNREGISTER;

const DEFAULT_SHELL_INPUT_CONTEXT: ShellInputContextValue = Object.freeze({
  cognitoActive: false,
  activeNonmodal: null,
  activePalette: false,
  modalDepth: 0,
  activeModalTokens: [],
  isTerminalSuppressed: false,
  setSurfaceOpen: () => {},
  registerModalMount: DEFAULT_REGISTER_MODAL_MOUNT,
  closeActiveNonmodal: () => {},
});

export function useOptionalShellInputContext(): ShellInputContextValue | null {
  return useContext(ShellInputContext);
}

export function useShellInputContext(): ShellInputContextValue {
  const context = useContext(ShellInputContext);
  return context ?? DEFAULT_SHELL_INPUT_CONTEXT;
}

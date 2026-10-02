import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
export type NativeAdvisorUiIntent = "activate" | "dismiss";
import type { AdvisorSlotDescriptor } from "@/lib/workspace-advisor-placement.js";

export interface WorkspaceAdvisorPlacementContextValue {
  activeSlot: AdvisorSlotDescriptor | null;
  registerSlot: (slot: AdvisorSlotDescriptor) => () => void;
  updateSlot: (slot: Partial<AdvisorSlotDescriptor> & { id: string }) => void;
  onUiIntent?: (intent: NativeAdvisorUiIntent | string) => void;
  onClose?: () => void;
  launcherRef: React.RefObject<HTMLElement | null>;
  setLauncherElement: (element: HTMLElement | null) => void;
}

const WorkspaceAdvisorPlacementContext =
  createContext<WorkspaceAdvisorPlacementContextValue | null>(null);

export interface WorkspaceAdvisorPlacementProviderProps {
  children: ReactNode;
  onUiIntent?: (intent: NativeAdvisorUiIntent | string) => void;
  onClose?: () => void;
  launcherRef?: React.RefObject<HTMLElement | null>;
}

export function WorkspaceAdvisorPlacementProvider({
  children,
  onUiIntent,
  onClose,
  launcherRef: externalLauncherRef,
}: WorkspaceAdvisorPlacementProviderProps) {
  const slotsRef = useRef<Map<string, AdvisorSlotDescriptor>>(new Map());
  const [activeSlot, setActiveSlot] = useState<AdvisorSlotDescriptor | null>(
    null,
  );
  const internalLauncherRef = useRef<HTMLElement | null>(null);
  const launcherRef = externalLauncherRef ?? internalLauncherRef;
  const resolveActiveSlot = useCallback(() => {
    const slots = Array.from(slotsRef.current.values());
    const visibleSlot =
      slots.find((s) => s.visible && s.element !== null) ?? null;
    setActiveSlot((current) => {
      if (
        current?.id === visibleSlot?.id &&
        current?.element === visibleSlot?.element &&
        current?.visible === visibleSlot?.visible &&
        current?.zIndex === visibleSlot?.zIndex &&
        current?.mode === visibleSlot?.mode &&
        current?.onActivate === visibleSlot?.onActivate
      ) {
        return current;
      }
      return visibleSlot;
    });
  }, []);

  const registerSlot = useCallback(
    (slot: AdvisorSlotDescriptor) => {
      slotsRef.current.set(slot.id, slot);
      resolveActiveSlot();
      return () => {
        slotsRef.current.delete(slot.id);
        resolveActiveSlot();
      };
    },
    [resolveActiveSlot],
  );

  const updateSlot = useCallback(
    (patch: Partial<AdvisorSlotDescriptor> & { id: string }) => {
      const existing = slotsRef.current.get(patch.id);
      if (!existing) return;
      slotsRef.current.set(patch.id, { ...existing, ...patch });
      resolveActiveSlot();
    },
    [resolveActiveSlot],
  );

  const setLauncherElement = useCallback(
    (element: HTMLElement | null) => {
      internalLauncherRef.current = element;
      if (externalLauncherRef) {
        /* eslint-disable react-hooks/immutability */
        (
          externalLauncherRef as React.MutableRefObject<HTMLElement | null>
        ).current = element;
        /* eslint-enable react-hooks/immutability */
      }
    },
    [externalLauncherRef],
  );

  const value = useMemo<WorkspaceAdvisorPlacementContextValue>(
    () => ({
      activeSlot,
      registerSlot,
      updateSlot,
      onUiIntent,
      onClose,
      launcherRef,
      setLauncherElement,
    }),
    [
      activeSlot,
      registerSlot,
      updateSlot,
      onUiIntent,
      onClose,
      launcherRef,
      setLauncherElement,
    ],
  );

  return (
    <WorkspaceAdvisorPlacementContext.Provider value={value}>
      {children}
    </WorkspaceAdvisorPlacementContext.Provider>
  );
}

export function useWorkspaceAdvisorPlacement(): WorkspaceAdvisorPlacementContextValue | null {
  return useContext(WorkspaceAdvisorPlacementContext);
}

import * as React from "react";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef, FsTargetRef } from "@/api/ownership.js";
import { executeAction } from "./action-executor.js";
import { APP_MANIFESTS } from "./app-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useOptionalShellInputContext } from "./shell-input-context.js";
import type {
  OsActionId,
  OsAppId,
  TerminalDirectoryKind,
  WindowContext,
} from "./types.js";
import { useWindowStore } from "./window-store.js";

export interface DesktopCapturedContext {
  readonly desktopId: string;
  readonly owner?: ConnectionRef | null;
  readonly target?: FsTargetRef;
  readonly windowContext?: WindowContext;
  readonly cwd?: string | null;
  readonly directoryKind?: TerminalDirectoryKind;
}

export interface DesktopContextMenuProps {
  desktopId: string;
  getContext?: () => DesktopCapturedContext | null;
  portalContainer?: HTMLElement | null;
  className?: string;
  onOpenApps?: () => void;
  onOpenPalette?: () => void;
  onNotice?: (notice: string) => void;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

/**
 * Dedicated focusable background context menu for the OS desktop (Architecture Contract C8).
 *
 * Invariants:
 * - Sibling behind windows, not ancestor around window children.
 * - Captures desktop, owner, and target context at open time.
 * - Revalidates context on selection; stale/removed owner blocks with guidance without fallback B.
 * - New Terminal preserves C12 directory semantics through shared executor.
 * - Palette and Desktop Appearance invoke shared action executor.
 * - Synchronously dismisses on Cognito activation and ignores right-clicks when modal is active.
 * - Excludes events originating from descendant window/terminal/editor/dialog content.
 */
export function DesktopContextMenu({
  desktopId,
  getContext,
  portalContainer,
  className,
  onOpenApps,
  onOpenPalette,
  onNotice,
  onOpenChange,
  children,
}: DesktopContextMenuProps) {
  const [open, setOpen] = React.useState(false);
  const shellInput = useOptionalShellInputContext();
  const capturedContextRef = React.useRef<DesktopCapturedContext | null>(null);

  const captureContextSnapshot = React.useCallback((): DesktopCapturedContext => {
    const provided = getContext?.();
    if (provided) {
      return {
        desktopId: provided.desktopId ?? desktopId,
        owner: provided.owner ? { ...provided.owner } : null,
        target: provided.target ? { ...provided.target } : undefined,
        windowContext: provided.windowContext
          ? { ...provided.windowContext }
          : undefined,
        cwd: provided.cwd ?? null,
        directoryKind: provided.directoryKind,
      };
    }

    const session = useWindowStore.getState().session;
    const desk = session.desktops.find((d) => d.id === desktopId);
    const focusedWin = desk?.focusedWindowId
      ? session.windows[desk.focusedWindowId]
      : undefined;
    const profileId = focusedWin?.ctx.profileId;
    const snap = profileId ? getConnectionSnapshot(profileId) : null;
    const owner = snap?.status === "connected" ? { ...snap.owner } : null;

    return {
      desktopId,
      owner,
      target: focusedWin?.ctx.target ? { ...focusedWin.ctx.target } : undefined,
      windowContext: focusedWin?.ctx ? { ...focusedWin.ctx } : undefined,
    };
  }, [desktopId, getContext]);

  const validateCapturedContext = (
    snapshot: DesktopCapturedContext,
  ): { valid: true } | { valid: false; reason: string } => {
    // 1. Validate destination desktop existence
    const session = useWindowStore.getState().session;
    const desktopExists = session.desktops.some(
      (d) => d.id === snapshot.desktopId,
    );
    if (!desktopExists) {
      return {
        valid: false,
        reason: `Desktop '${snapshot.desktopId}' no longer exists`,
      };
    }

    // 2. Validate connection owner currency
    if (snapshot.owner) {
      const snap = getConnectionSnapshot(snapshot.owner.profileId);
      if (!snap || snap.status !== "connected") {
        return {
          valid: false,
          reason: `Profile '${snapshot.owner.profileId}' is no longer connected`,
        };
      }
      if (snap.owner.generation !== snapshot.owner.generation) {
        return {
          valid: false,
          reason: `Connection to profile '${snapshot.owner.profileId}' was reconnected (stale generation ${snapshot.owner.generation} vs current ${snap.owner.generation})`,
        };
      }
    }

    return { valid: true };
  };

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        // Modal / Cognito privacy guard
        const isModalActive =
          (shellInput?.modalDepth ?? 0) > 0 ||
          useCognitoModeStore.getState().active;
        if (isModalActive) {
          return;
        }

        capturedContextRef.current = captureContextSnapshot();
      } else {
        capturedContextRef.current = null;
      }

      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [captureContextSnapshot, onOpenChange, shellInput?.modalDepth],
  );

  const handleContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;

    // Descendant exclusion: do not intercept clicks inside windows or child components
    if (
      target &&
      target !== e.currentTarget &&
      Boolean(
        target.closest(
          "[data-window-id], [data-os-window], [data-testid^='window-frame-'], .xterm, .monaco-editor, iframe, [role='dialog']",
        ),
      )
    ) {
      return;
    }

    const isModalActive =
      (shellInput?.modalDepth ?? 0) > 0 ||
      useCognitoModeStore.getState().active;
    if (isModalActive) {
      e.preventDefault();
      return;
    }
  };

  const handleNewTerminal = async () => {
    const snapshot = capturedContextRef.current;
    if (!snapshot) return;

    const validation = validateCapturedContext(snapshot);
    if (!validation.valid) {
      onNotice?.(validation.reason);
      return;
    }

    const owner = snapshot.owner;
    if (!owner) {
      onNotice?.("New Terminal requires an active profile connection");
      return;
    }

    const target: FsTargetRef = snapshot.target ?? {
      kind: "workspace",
      profileId: owner.profileId,
    };
    const cwd = snapshot.cwd ?? null;
    const directoryKind = snapshot.directoryKind ?? "profile-default";

    const result = await executeAction({
      id: "app.terminals.new-window",
      context: {
        kind: "desktop",
        desktopId: snapshot.desktopId,
        owner,
        target,
        windowContext: snapshot.windowContext,
      },
      terminalCreate: {
        target,
        cwd,
        directoryKind,
        owner,
        destinationDesktopId: snapshot.desktopId,
        windowContext: snapshot.windowContext ?? {
          profileId: owner.profileId,
        },
      },
    });
    if (result.kind === "blocked") {
      onNotice?.(result.reason);
    }
  };

  const handleOpenLauncher = () => {
    const snapshot = capturedContextRef.current;
    if (snapshot) {
      const validation = validateCapturedContext(snapshot);
      if (!validation.valid) {
        onNotice?.(validation.reason);
        return;
      }
    }
    onOpenApps?.();
  };

  const handleOpenApp = async (appId: OsAppId) => {
    const snapshot = capturedContextRef.current;
    if (snapshot) {
      const validation = validateCapturedContext(snapshot);
      if (!validation.valid) {
        onNotice?.(validation.reason);
        return;
      }
    }

    await executeAction({
      id: `app.${appId}.open` as OsActionId,
      context: {
        kind: "desktop",
        desktopId: snapshot?.desktopId ?? desktopId,
        owner: snapshot?.owner,
        target: snapshot?.target,
        windowContext: snapshot?.windowContext,
      },
    });
  };

  const handlePalette = async () => {
    const snapshot = capturedContextRef.current;
    if (snapshot) {
      const validation = validateCapturedContext(snapshot);
      if (!validation.valid) {
        onNotice?.(validation.reason);
        return;
      }
    }

    if (onOpenPalette) {
      onOpenPalette();
    }
    await executeAction({
      id: "os.palette",
      context: {
        kind: "desktop",
        desktopId: snapshot?.desktopId ?? desktopId,
        owner: snapshot?.owner,
      },
    });
  };

  const handleAppearance = async () => {
    const snapshot = capturedContextRef.current;
    if (snapshot) {
      const validation = validateCapturedContext(snapshot);
      if (!validation.valid) {
        onNotice?.(validation.reason);
        return;
      }
    }

    await executeAction({
      id: "app.settings.open",
      context: {
        kind: "desktop",
        desktopId: snapshot?.desktopId ?? desktopId,
        owner: snapshot?.owner,
      },
      settingsSection: "appearance",
    });
  };

  return (
    <>
      <ContextMenu.Root
        open={open}
        onOpenChange={handleOpenChange}
        portalContainer={portalContainer}
        portalOwner="os-desktop"
        isOwnedPortal={true}
      >
        <ContextMenu.Trigger>
          <div
            tabIndex={0}
            role="region"
            aria-label={`Desktop ${desktopId} background`}
            data-testid={`desktop-context-trigger-${desktopId}`}
            data-os-desktop-trigger={desktopId}
            onContextMenu={handleContextMenu}
            className={className ?? "absolute inset-0 z-0 outline-none select-none"}
          />
        </ContextMenu.Trigger>

        <ContextMenu.Content
          data-testid="desktop-context-menu"
          className="w-56"
        >
        <ContextMenu.Item
          data-testid="desktop-menu-item-terminal"
          onSelect={handleNewTerminal}
        >
          New Terminal
        </ContextMenu.Item>

        <ContextMenu.Sub>
          <ContextMenu.SubTrigger
            data-testid="desktop-menu-apps"
          >
            Apps
          </ContextMenu.SubTrigger>
          <ContextMenu.SubContent
            data-testid="desktop-menu-apps-content"
          >
            {onOpenApps && (
              <>
                <ContextMenu.Item
                  data-testid="desktop-menu-item-launcher"
                  onSelect={handleOpenLauncher}
                >
                  All Apps & Launcher...
                </ContextMenu.Item>
                <ContextMenu.Separator />
              </>
            )}
            {Object.entries(APP_MANIFESTS).map(([appId, manifest]) => (
              <ContextMenu.Item
                key={appId}
                data-testid={`desktop-menu-app-${appId}`}
                onSelect={() => handleOpenApp(appId as OsAppId)}
              >
                {manifest.displayName}
              </ContextMenu.Item>
            ))}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>

        <ContextMenu.Item
          data-testid="desktop-menu-item-palette"
          onSelect={handlePalette}
        >
          Command Palette
        </ContextMenu.Item>

        <ContextMenu.Separator />

        <ContextMenu.Item
          data-testid="desktop-menu-item-appearance"
          onSelect={handleAppearance}
        >
          Desktop Appearance
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
    {children}
  </>
  );
}

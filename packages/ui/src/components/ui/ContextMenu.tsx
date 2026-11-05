import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils.js";
import {
  claimContextMenu,
  releaseContextMenu,
} from "@/lib/context-menu-coordinator.js";
import { contextMenuTriggerMarker } from "@/lib/context-menu-trigger-marker.js";

export interface ContextMenuOwnershipContextValue {
  container?: HTMLElement | null;
  portalOwner?: string;
  isOwnedPortal?: boolean;
}

const ContextMenuOwnershipContext =
  React.createContext<ContextMenuOwnershipContextValue>({});

type RootProps = React.ComponentProps<typeof ContextMenuPrimitive.Root> & {
  defaultOpen?: boolean;
  portalContainer?: HTMLElement | null;
  portalOwner?: string;
  isOwnedPortal?: boolean;
};
const PortalScope = React.createContext(false);

/**
 * Adds app-level coordination around Radix's local menu state. The coordinator
 * is intentionally module-scoped: context menus are transient UI state and do
 * not need a store or provider in the application state graph.
 */
function ContextMenuRoot({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  portalContainer,
  portalOwner,
  isOwnedPortal,
  ...props
}: RootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const close = React.useCallback(() => {
    if (!isControlled) setUncontrolledOpen(false);
    onOpenChangeRef.current?.(false);
  }, [isControlled]);

  React.useEffect(() => {
    if (open) {
      claimContextMenu(close, portalOwner);
    } else {
      releaseContextMenu(close);
    }
    return () => releaseContextMenu(close);
  }, [close, open, portalOwner]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) claimContextMenu(close, portalOwner);
      else releaseContextMenu(close);
      if (!isControlled) setUncontrolledOpen(nextOpen);
      onOpenChangeRef.current?.(nextOpen);
    },
    [close, isControlled, portalOwner],
  );

  const ownershipValue = React.useMemo<ContextMenuOwnershipContextValue>(
    () => ({
      container: portalContainer,
      portalOwner,
      isOwnedPortal:
        isOwnedPortal ??
        (portalContainer !== undefined || portalOwner !== undefined),
    }),
    [portalContainer, portalOwner, isOwnedPortal],
  );

  return (
    <ContextMenuOwnershipContext.Provider value={ownershipValue}>
      <ContextMenuPrimitive.Root
        {...props}
        open={open}
        onOpenChange={handleOpenChange}
      />
    </ContextMenuOwnershipContext.Provider>
  );
}

type TriggerProps = Omit<
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>,
  "asChild" | "children"
> & { children: React.ReactElement };

const ContextMenuTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Trigger>,
  TriggerProps
>(function ContextMenuTrigger(props, ref) {
  const { onKeyDown, ...triggerProps } = props;
  const markerProps = triggerProps.disabled
    ? {}
    : { [contextMenuTriggerMarker]: "" };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))
    ) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  };

  return (
    <ContextMenuPrimitive.Trigger
      {...triggerProps}
      asChild
      ref={ref}
      onKeyDown={handleKeyDown}
      {...markerProps}
    />
  );
});

type PortalProps = React.ComponentProps<
  typeof ContextMenuPrimitive.Portal
> & {
  container?: HTMLElement | null;
  portalOwner?: string;
};

function ContextMenuPortal({
  children,
  container: containerProp,
  portalOwner,
  ...props
}: PortalProps) {
  const parentOwnership = React.useContext(ContextMenuOwnershipContext);
  const container =
    containerProp !== undefined ? containerProp : parentOwnership.container;
  const effectiveOwner = portalOwner ?? parentOwnership.portalOwner;
  const isOwned =
    parentOwnership.isOwnedPortal ||
    containerProp !== undefined ||
    portalOwner !== undefined;

  const ownershipValue = React.useMemo<ContextMenuOwnershipContextValue>(
    () => ({
      container,
      portalOwner: effectiveOwner,
      isOwnedPortal: isOwned,
    }),
    [container, effectiveOwner, isOwned],
  );

  return (
    <ContextMenuOwnershipContext.Provider value={ownershipValue}>
      <PortalScope.Provider value={true}>
        <ContextMenuPrimitive.Portal container={container} {...props}>
          {children}
        </ContextMenuPrimitive.Portal>
      </PortalScope.Provider>
    </ContextMenuOwnershipContext.Provider>
  );
}

export interface ContextMenuContentProps
  extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> {
  portalContainer?: HTMLElement | null;
  portalOwner?: string;
}

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  ContextMenuContentProps
>(function ContextMenuContent(
  {
    className,
    avoidCollisions = true,
    collisionPadding = 8,
    onPointerDown,
    onMouseDown,
    portalContainer: portalContainerProp,
    portalOwner: portalOwnerProp,
    ...props
  },
  ref,
) {
  const inPortal = React.useContext(PortalScope);
  const ownership = React.useContext(ContextMenuOwnershipContext);
  const container =
    portalContainerProp !== undefined
      ? portalContainerProp
      : ownership.container;
  const isOwned =
    ownership.isOwnedPortal ||
    portalContainerProp !== undefined ||
    portalOwnerProp !== undefined;
  const ownerAttr =
    portalOwnerProp ?? ownership.portalOwner ?? (isOwned ? "true" : undefined);

  const content = (
    <ContextMenuPrimitive.Content
      ref={ref}
      avoidCollisions={avoidCollisions}
      collisionPadding={collisionPadding}
      updatePositionStrategy="always"
      {...(isOwned ? { "data-os-menu-portal": ownerAttr } : {})}
      className={cn(
        "z-[100] max-h-[var(--radix-context-menu-content-available-height)] max-w-[var(--radix-context-menu-content-available-width)] min-w-40 overflow-y-auto overflow-x-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text)] shadow-xl outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e);
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown?.(e);
      }}
      {...props}
    />
  );
  return inPortal ? (
    content
  ) : (
    <ContextMenuPrimitive.Portal container={container}>
      {content}
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

function ContextMenuItem({
  className,
  onPointerDown,
  onMouseDown,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      {...props}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none",
        "focus:bg-[var(--color-primary)]/10 focus:text-[var(--color-primary)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e);
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown?.(e);
      }}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      {...props}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 pl-8 text-xs outline-none",
        "focus:bg-[var(--color-primary)]/10 focus:text-[var(--color-primary)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    />
  );
}

function ContextMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      {...props}
      className={cn(
        "px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]",
        className,
      )}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      {...props}
      className={cn("-mx-1 my-1 h-px bg-[var(--color-border)]", className)}
    />
  );
}
const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(function ContextMenuSubTrigger(
  { className, inset, children, ...props },
  ref,
) {
  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-[var(--color-surface-hover,var(--color-surface-2))] focus:text-[var(--color-text)] data-[state=open]:bg-[var(--color-surface-hover,var(--color-surface-2))] data-[state=open]:text-[var(--color-text)]",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.SubTrigger>
  );
});
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

export interface ContextMenuSubContentProps
  extends React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent> {
  portalContainer?: HTMLElement | null;
}

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  ContextMenuSubContentProps
>(function ContextMenuSubContent(
  { className, portalContainer, ...props },
  ref,
) {
  const ownership = React.useContext(ContextMenuOwnershipContext);
  const container =
    portalContainer !== undefined ? portalContainer : ownership.container;
  const isOwned = ownership.isOwnedPortal || portalContainer !== undefined;
  const ownerAttr = ownership.portalOwner ?? (isOwned ? "true" : undefined);
  const subContent = (
    <ContextMenuPrimitive.SubContent
      ref={ref}
      {...(isOwned ? { "data-os-menu-portal": ownerAttr } : {})}
      className={cn(
        "z-[100] min-w-32 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text)] shadow-lg outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );

  return (
    <ContextMenuPrimitive.Portal container={container}>
      {subContent}
    </ContextMenuPrimitive.Portal>
  );
});
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenu = {
  Root: ContextMenuRoot,
  Trigger: ContextMenuTrigger,
  Portal: ContextMenuPortal,
  Content: ContextMenuContent,
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
} as const;

export {
  ContextMenu,
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuOwnershipContext,
};
